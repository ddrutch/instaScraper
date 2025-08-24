// Apify SDK - toolkit for building Apify Actors (Read more at https://docs.apify.com/sdk/js/).
import { Actor } from 'apify';
// Crawlee Puppeteer - browser automation library for web scraping
import { PuppeteerCrawler } from '@crawlee/puppeteer';

// The init() call configures the Actor for its environment. It's recommended to start every Actor with an init().
await Actor.init();

interface Input {
    url: string;
}

interface ReelData {
    username?: string;
    audioUsed?: string;
    comments?: number;
    likes?: number;
    views?: number;
    title?: string;
    description?: string;
    url: string;
    error?: string;
}

// Structure of input is defined in input_schema.json
const input = await Actor.getInput<Input>();
if (!input) throw new Error('Input is missing!');
const { url } = input;

// Validate that it's an Instagram reel URL
if (!url.match(/^https?:\/\/www\.instagram\.com\/reel\/.+$/)) {
    throw new Error('Invalid Instagram reel URL provided');
}

console.log(`Starting to scrape Instagram reel: ${url}`);

const crawler = new PuppeteerCrawler({
    // Use headless browser
    launchContext: {
        launchOptions: {
            headless: true,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-accelerated-2d-canvas',
                '--no-first-run',
                '--no-zygote',
                '--disable-gpu',
            ],
        },
    },
    // Configure request handling with reduced timeouts
    requestHandlerTimeoutSecs: 30, // Reduced from 60
    maxRequestRetries: 2, // Reduced from 3
    
    async requestHandler({ page, request }) {
        console.log(`Processing: ${request.url}`);
        
        const reelData: ReelData = {
            url: request.url
        };

        try {
            // Navigate to the reel
            await page.goto(request.url, { waitUntil: 'domcontentloaded', timeout: 20000 });
            
            // Wait for video element instead of article (reels use video containers)
            try {
                await page.waitForSelector('video, [role="dialog"]', { timeout: 8000 });
                console.log('Video/dialog element found - page loaded successfully');
            } catch (e) {
                console.log('Video/dialog not found, trying alternative wait strategy');
                // Fallback: just wait for any content to load
                await page.waitForSelector('body', { timeout: 5000 });
            }
            
            // Short wait for dynamic content
            await new Promise(resolve => setTimeout(resolve, 2000));
            
            // Check if we're blocked or redirected
            const currentUrl = page.url();
            if (!currentUrl.includes('instagram.com/reel/')) {
                throw new Error(`Redirected away from reel: ${currentUrl}`);
            }

            // Simplified extraction with faster fallbacks
            console.log('Starting data extraction...');
            
            // Quick text extraction for pattern matching
            const pageText = await page.evaluate(() => document.body.textContent || '');
            console.log('Page text length:', pageText.length);
            
            // Extract username - avoid login/signup links
            try {
                // Method 1: Look for profile links that aren't login/signup
                const profileLinks = await page.$$('a[href^="/"]:not([href="/"]):not([href*="accounts"]):not([href*="login"]):not([href*="signup"])');
                
                for (const link of profileLinks) {
                    const href = await page.evaluate((el: Element) => (el as HTMLAnchorElement).href, link);
                    const text = await page.evaluate((el: Element) => el.textContent, link);
                    
                    if (href) {
                        // Extract username from href like https://instagram.com/maykonreplay/
                        const match = href.match(/instagram\.com\/([^/?#]+)\/?$/);
                        if (match && match[1] && 
                            !match[1].includes('accounts') && 
                            !match[1].includes('reel') && 
                            !match[1].includes('audio') && 
                            !match[1].includes('explore') &&
                            match[1].length > 1) {
                            reelData.username = match[1];
                            console.log('Found username from profile link:', match[1]);
                            break;
                        }
                    }
                    
                    // Fallback: clean text content
                    if (text && text.trim() && 
                        !text.includes('Follow') && 
                        !text.includes('Sign') &&
                        !text.includes('Log') &&
                        !text.includes('•') &&
                        text.length > 1 && text.length < 30) {
                        reelData.username = text.trim();
                        console.log('Found username from text:', text.trim());
                        break;
                    }
                }
                
                // Method 2: Try header username specifically
                if (!reelData.username) {
                    const headerSelectors = [
                        'header h2 a',
                        'header h1 a', 
                        'header a[href^="/"]:not([href*="accounts"])',
                    ];
                    
                    for (const selector of headerSelectors) {
                        try {
                            const element = await page.$(selector);
                            if (element) {
                                const href = await page.evaluate((el: Element) => (el as HTMLAnchorElement).href, element);
                                if (href) {
                                    const match = href.match(/instagram\.com\/([^/?#]+)\/?$/);
                                    if (match && match[1] && !match[1].includes('accounts')) {
                                        reelData.username = match[1];
                                        console.log('Found username from header:', match[1]);
                                        break;
                                    }
                                }
                            }
                        } catch (e) {
                            // Continue to next selector
                        }
                    }
                }
            } catch (e) {
                console.log('Username extraction error:', e);
            }

            // Extract engagement metrics with better number detection
            try {
                console.log('Extracting engagement metrics...');
                
                // Strategy 1: Look for large numbers in page text first
                const largeNumberPattern = /(\d{1,3}(?:,\d{3})+)\s*(?:likes?|views?|comments?)/gi;
                let largeNumberMatches = pageText.match(largeNumberPattern);
                
                if (largeNumberMatches) {
                    console.log('Found large number patterns:', largeNumberMatches);
                    for (const match of largeNumberMatches) {
                        if (match.includes('like')) {
                            const numMatch = match.match(/(\d{1,3}(?:,\d{3})+)/i);
                            if (numMatch) {
                                reelData.likes = parseMetric(numMatch[1]);
                                console.log('Found large likes number:', reelData.likes);
                            }
                        }
                        if (match.includes('view')) {
                            const numMatch = match.match(/(\d{1,3}(?:,\d{3})+)/i);
                            if (numMatch) {
                                reelData.views = parseMetric(numMatch[1]);
                                console.log('Found large views number:', reelData.views);
                            }
                        }
                        if (match.includes('comment')) {
                            const numMatch = match.match(/(\d{1,3}(?:,\d{3})+)/i);
                            if (numMatch) {
                                reelData.comments = parseMetric(numMatch[1]);
                                console.log('Found large comments number:', reelData.comments);
                            }
                        }
                    }
                }
                
                // Strategy 2: Standard patterns with K/M notation
                if (!reelData.likes) {
                    const likesPatterns = [
                        /(\d{1,3}(?:[,.]\d{3})*(?:\.\d+)?[KMB]?)\s*likes?/gi,
                        /Liked by\s+.*?and\s+(\d{1,3}(?:[,.]\d{3})*(?:\.\d+)?[KMB]?)\s*others/gi
                    ];
                    
                    for (const pattern of likesPatterns) {
                        const match = pageText.match(pattern);
                        if (match && match[0]) {
                            const numMatch = match[0].match(/(\d{1,3}(?:[,.]\d{3})*(?:\.\d+)?[KMB]?)/i);
                            if (numMatch) {
                                reelData.likes = parseMetric(numMatch[1]);
                                console.log('Found likes with pattern:', reelData.likes);
                                break;
                            }
                        }
                    }
                }
                
                // Views (if not found above)
                if (!reelData.views) {
                    const viewsMatch = pageText.match(/(\d{1,3}(?:[,.]\d{3})*(?:\.\d+)?[KMB]?)\s*(?:views?|plays?)/gi);
                    if (viewsMatch && viewsMatch[0]) {
                        const numMatch = viewsMatch[0].match(/(\d{1,3}(?:[,.]\d{3})*(?:\.\d+)?[KMB]?)/i);
                        if (numMatch) {
                            reelData.views = parseMetric(numMatch[1]);
                            console.log('Found views:', reelData.views);
                        }
                    }
                }
                
                // Comments (if not found above)
                if (!reelData.comments) {
                    // Try exact selector from HTML inspection
                    try {
                        const commentsLink = await page.$('a[href*="/comments/"] span');
                        if (commentsLink) {
                            const commentsText = await page.evaluate((el: Element) => el.textContent, commentsLink);
                            if (commentsText) {
                                const numMatch = commentsText.match(/(\d{1,3}(?:[,.]\d{3})*(?:\.\d+)?[KMB]?)/i);
                                if (numMatch) {
                                    reelData.comments = parseMetric(numMatch[1]);
                                    console.log('Found comments from link:', reelData.comments);
                                }
                            }
                        }
                    } catch (e) {
                        console.log('Comments link extraction failed:', e);
                    }
                }
                
                // Fallback: regex pattern for comments
                if (!reelData.comments) {
                    const commentsMatch = pageText.match(/(?:View all\s+)?(\d{1,3}(?:[,.]\d{3})*(?:\.\d+)?[KMB]?)\s*comments?/gi);
                    if (commentsMatch && commentsMatch[0]) {
                        const numMatch = commentsMatch[0].match(/(\d{1,3}(?:[,.]\d{3})*(?:\.\d+)?[KMB]?)/i);
                        if (numMatch) {
                            reelData.comments = parseMetric(numMatch[1]);
                            console.log('Found comments with regex:', reelData.comments);
                        }
                    }
                }
                
            } catch (e) {
                console.log('Metrics extraction error:', e);
            }

            // Extract audio info using the exact selector from HTML inspection
            try {
                console.log('Extracting audio information...');
                
                // Strategy 1: Use the exact audio link selector
                try {
                    const audioLink = await page.$('a[href*="/reels/audio/"]');
                    if (audioLink) {
                        const audioText = await page.evaluate((el: Element) => el.textContent, audioLink);
                        if (audioText && audioText.trim()) {
                            reelData.audioUsed = audioText.trim();
                            console.log('Found audio from audio link:', audioText.trim());
                        }
                    }
                } catch (e) {
                    console.log('Audio link selector failed:', e);
                }
                
                // Strategy 2: Look for clean "Artist • Song" pattern in text (backup)
                if (!reelData.audioUsed) {
                    const cleanAudioPattern = /([A-Za-z][A-Za-z0-9\s]{2,30})\s*•\s*([A-Za-z][A-Za-z0-9\s]{2,30})/g;
                    const cleanAudioMatch = pageText.match(cleanAudioPattern);
                    
                    if (cleanAudioMatch) {
                        for (const match of cleanAudioMatch) {
                            if (!match.includes('Sign') && 
                                !match.includes('Log') && 
                                !match.includes('Follow') &&
                                !match.includes('Verified') &&
                                match.length < 100) {
                                reelData.audioUsed = match.trim();
                                console.log('Found audio from pattern:', match.trim());
                                break;
                            }
                        }
                    }
                }
                
                // Strategy 3: Fallback to status patterns
                if (!reelData.audioUsed) {
                    const audioPatterns = [
                        /Original audio/gi,
                        /Audio is muted/gi,
                        /Sound on/gi,
                        /Sound off/gi
                    ];
                    
                    for (const pattern of audioPatterns) {
                        const match = pageText.match(pattern);
                        if (match) {
                            reelData.audioUsed = match[0];
                            console.log('Found audio status:', match[0]);
                            break;
                        }
                    }
                }
                
                // Final fallback
                if (!reelData.audioUsed) {
                    reelData.audioUsed = 'Audio not detected';
                }
            } catch (e) {
                console.log('Audio extraction error:', e);
                reelData.audioUsed = 'Audio extraction failed';
            }

            // Extract caption/description using exact H1 selector from inspection
            try {
                console.log('Extracting user caption...');
                
                // Strategy 1: Use exact H1 selector from HTML inspection
                try {
                    const h1Element = await page.$('h1._ap3a._aaco._aacu._aacx._aad7._aade');
                    if (h1Element) {
                        const captionText = await page.evaluate((el: Element) => el.textContent, h1Element);
                        if (captionText && captionText.trim()) {
                            reelData.description = captionText.trim();
                            reelData.title = captionText.trim();
                            console.log('Found caption from H1:', captionText.trim());
                        }
                    }
                } catch (e) {
                    console.log('H1 selector failed:', e);
                }
                
                // Strategy 2: Fallback to other caption selectors
                if (!reelData.description) {
                    const captionSelectors = [
                        'h1[dir="auto"]',
                        'h1',
                        'span[dir="auto"]',
                        'div[class*="caption"] span',
                        'article span'
                    ];
                    
                    for (const selector of captionSelectors) {
                        try {
                            const elements = await page.$$(selector);
                            for (const element of elements) {
                                const text = await page.evaluate((el: Element) => el.textContent, element);
                                if (text && text.trim().length > 10 && 
                                    !text.includes('likes') && 
                                    !text.includes('views') && 
                                    !text.includes('comments') &&
                                    !text.includes('Follow') &&
                                    !text.includes('•') &&  // Exclude audio info (has bullet)
                                    !text.includes('The Black Eyed Peas') && // Exclude audio info
                                    !text.includes('Sign') &&
                                    !text.includes('Log') &&
                                    text !== reelData.username) {
                                    reelData.description = text.trim();
                                    reelData.title = text.trim();
                                    console.log('Found user caption:', text.trim());
                                    break;
                                }
                            }
                            if (reelData.description) break;
                        } catch (e) {
                            // Continue to next selector
                        }
                    }
                }
                
                // Strategy 3: Look for caption patterns in page text (with emojis)
                if (!reelData.description) {
                    // Look for text that contains emojis or typical caption patterns
                    const lines = pageText.split('\n');
                    for (const line of lines) {
                        const cleanLine = line.trim();
                        if (cleanLine.length > 10 && cleanLine.length < 200 &&
                            !cleanLine.includes('likes') &&
                            !cleanLine.includes('views') &&
                            !cleanLine.includes('comments') &&
                            !cleanLine.includes('Follow') &&
                            !cleanLine.includes('•') &&
                            !cleanLine.includes('The Black Eyed Peas') &&
                            cleanLine !== reelData.username &&
                            (cleanLine.includes('🕹') || cleanLine.includes('🤖') || cleanLine.includes('🎥') || cleanLine.includes('❤️') || cleanLine.toLowerCase().includes('rock'))) {
                            reelData.description = cleanLine;
                            reelData.title = cleanLine;
                            console.log('Found caption with emojis:', cleanLine);
                            break;
                        }
                    }
                }
            } catch (e) {
                console.log('Caption extraction error:', e);
            }

            // Log extracted data
            console.log('Extracted reel data:', reelData);
            
            // Save the data
            await Actor.pushData(reelData);
            
        } catch (error) {
            console.error('Error scraping reel:', error);
            reelData.error = error instanceof Error ? error.message : 'Unknown error occurred';
            await Actor.pushData(reelData);
        }
    },
});

// Helper function to parse metrics like "1.2K", "500", "2.5M", "817,242" into numbers
function parseMetric(value: string): number {
    if (!value) return 0;
    
    // Clean the value - remove commas and normalize
    const cleanValue = value.replace(/[,\s]/g, '').toUpperCase();
    
    // Handle decimal separators (both . and ,)
    const numericPart = cleanValue.match(/(\d+(?:[.,]\d+)?)/)?.[1] || '0';
    const normalizedNumeric = numericPart.replace(',', '.'); // Normalize decimal separator
    const numericValue = parseFloat(normalizedNumeric);
    
    // Apply multipliers
    if (cleanValue.includes('B')) {
        return Math.round(numericValue * 1000000000); // Billion
    } else if (cleanValue.includes('M')) {
        return Math.round(numericValue * 1000000); // Million
    } else if (cleanValue.includes('K')) {
        return Math.round(numericValue * 1000); // Thousand
    } else {
        return Math.round(numericValue);
    }
}

// Add the URL to the request queue
await crawler.addRequests([{ url }]);

// Start the crawling
await crawler.run();

// Gracefully exit the Actor process. It's recommended to quit all Actors with an exit().
await Actor.exit();