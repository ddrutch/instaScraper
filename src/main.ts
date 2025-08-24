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
    // Configure request handling
    requestHandlerTimeoutSecs: 60,
    maxRequestRetries: 3,
    
    async requestHandler({ page, request }) {
        console.log(`Processing: ${request.url}`);
        
        const reelData: ReelData = {
            url: request.url
        };

        try {
            // Navigate and wait for the page to load
            await page.goto(request.url, { waitUntil: 'networkidle2', timeout: 30000 });
            
            // Wait for Instagram content to load
            try {
                await page.waitForSelector('article', { timeout: 10000 });
            } catch (e) {
                console.log('Article element not found, continuing anyway');
            }
            
            // Additional wait for dynamic content
            await new Promise(resolve => setTimeout(resolve, 5000));
            
            // Check if we're blocked or redirected
            const currentUrl = page.url();
            if (!currentUrl.includes('instagram.com/reel/')) {
                throw new Error(`Redirected away from reel: ${currentUrl}`);
            }

            // Extract data using multiple strategies - Instagram's structure changes frequently
            // Strategy 1: Try Instagram's internal API data (most reliable)
            try {
                const pageData = await page.evaluate(() => {
                    // Look for Instagram's internal data in script tags
                    const scripts = Array.from(document.querySelectorAll('script'));
                    for (const script of scripts) {
                        if (script.textContent && script.textContent.includes('"shortcode_media"')) {
                            try {
                                const match = script.textContent.match(/window\._sharedData\s*=\s*({.+?});/);
                                if (match) {
                                    return JSON.parse(match[1]);
                                }
                            } catch (e) {
                                // Continue to next script
                            }
                        }
                    }
                    return null;
                });
                
                if (pageData && pageData.entry_data?.PostPage?.[0]?.graphql?.shortcode_media) {
                    const media = pageData.entry_data.PostPage[0].graphql.shortcode_media;
                    reelData.username = media.owner?.username;
                    reelData.likes = media.edge_media_preview_like?.count;
                    reelData.views = media.video_view_count;
                    reelData.comments = media.edge_media_to_comment?.count;
                    reelData.description = media.edge_media_to_caption?.edges?.[0]?.node?.text;
                    if (reelData.description) {
                        const firstLine = reelData.description.split('\n')[0].trim();
                        if (firstLine.length <= 100) {
                            reelData.title = firstLine;
                        }
                    }
                    console.log('Extracted data from internal API');
                }
            } catch (e) {
                console.log('Could not extract from internal API:', e);
            }
            
            // Strategy 2: Enhanced DOM selectors with multiple fallbacks
            
            // Extract username with improved selectors
            if (!reelData.username) {
                try {
                    const usernameSelectors = [
                        // Main header username link
                        'article header h2 a',
                        'header h2 a',
                        'article header div div div a[href^="/"]',
                        // Alternative patterns
                        'span[dir="auto"] a[href^="/"]',
                        'a[role="link"][href^="/"]:not([href="/"])',
                        // Fallback to any profile link in header
                        'header a[href^="/"]:not([href="/"])',
                    ];
                    
                    for (const selector of usernameSelectors) {
                        const elements = await page.$$(selector);
                        for (const element of elements) {
                            const href = await page.evaluate((el: Element) => (el as HTMLAnchorElement).href, element);
                            const text = await page.evaluate((el: Element) => el.textContent, element);
                            
                            if (href && text) {
                                const usernameFromHref = href.match(/instagram\.com\/([^/]+)/)?.[1];
                                const usernameFromText = text.trim();
                                
                                // Prefer href extraction, fallback to text
                                const username = usernameFromHref || usernameFromText;
                                if (username && !username.includes('•') && !username.includes('instagram.com') && username.length > 0) {
                                    reelData.username = username;
                                    break;
                                }
                            }
                        }
                        if (reelData.username) break;
                    }
                } catch (e) {
                    console.log('Could not extract username:', e);
                }
            }

            // Extract audio/music info with better targeting
            if (!reelData.audioUsed) {
                try {
                    const audioSelectors = [
                        // Modern audio attribution patterns
                        'div[class*="music"] span',
                        'div[class*="audio"] span',
                        'a[href*="/audio-page/"]',
                        '[data-testid="audio-attribution"]',
                        // Text-based approaches
                        'span:contains("Original audio")',
                        'span:contains("•")', // Audio separator pattern
                    ];
                    
                    // Also try text content analysis
                    const allText = await page.evaluate(() => document.body.textContent || '');
                    
                    // Look for audio patterns in text
                    const audioPatterns = [
                        /([^\n•]+)\s*•\s*([^\n•]+)/g, // Artist • Song pattern
                        /(Original audio)/i,
                        /(Audio is muted)/i
                    ];
                    
                    for (const pattern of audioPatterns) {
                        const match = allText.match(pattern);
                        if (match) {
                            reelData.audioUsed = match[0].trim();
                            break;
                        }
                    }
                    
                    // If no text pattern, try DOM selectors
                    if (!reelData.audioUsed) {
                        for (const selector of audioSelectors) {
                            const audioElement = await page.$(selector);
                            if (audioElement) {
                                const audio = await page.evaluate((el: Element) => el.textContent, audioElement);
                                if (audio && audio.trim() && audio.length > 3) {
                                    reelData.audioUsed = audio.trim();
                                    break;
                                }
                            }
                        }
                    }
                    
                    // Fallback
                    if (!reelData.audioUsed) {
                        reelData.audioUsed = 'Audio not detected';
                    }
                } catch (e) {
                    console.log('Could not extract audio info:', e);
                    reelData.audioUsed = 'Audio extraction failed';
                }
            }

            // Extract engagement metrics with enhanced pattern matching
            if (!reelData.likes || !reelData.views || !reelData.comments) {
                try {
                    // Get page text for regex analysis
                    const pageText = await page.evaluate(() => document.body.textContent || '');
                    
                    // Enhanced regex patterns for metrics
                    const patterns = {
                        likes: [
                            /(\d{1,3}(?:[,.]\d{3})*(?:\.\d+)?[KMB]?)\s*likes?/gi,
                            /(\d{1,3}(?:[,.]\d{3})*(?:\.\d+)?[KMB]?)\s*like/gi,
                            /Liked by\s+.*?and\s+(\d{1,3}(?:[,.]\d{3})*(?:\.\d+)?[KMB]?)\s*others/gi
                        ],
                        views: [
                            /(\d{1,3}(?:[,.]\d{3})*(?:\.\d+)?[KMB]?)\s*views?/gi,
                            /(\d{1,3}(?:[,.]\d{3})*(?:\.\d+)?[KMB]?)\s*plays?/gi
                        ],
                        comments: [
                            /View all\s+(\d{1,3}(?:[,.]\d{3})*(?:\.\d+)?[KMB]?)\s*comments?/gi,
                            /(\d{1,3}(?:[,.]\d{3})*(?:\.\d+)?[KMB]?)\s*comments?/gi
                        ]
                    };
                    
                    // Extract likes
                    if (!reelData.likes) {
                        for (const pattern of patterns.likes) {
                            const match = pageText.match(pattern);
                            if (match) {
                                const numMatch = match[0].match(/(\d{1,3}(?:[,.]\d{3})*(?:\.\d+)?[KMB]?)/i);
                                if (numMatch) {
                                    reelData.likes = parseMetric(numMatch[1]);
                                    break;
                                }
                            }
                        }
                    }
                    
                    // Extract views
                    if (!reelData.views) {
                        for (const pattern of patterns.views) {
                            const match = pageText.match(pattern);
                            if (match) {
                                const numMatch = match[0].match(/(\d{1,3}(?:[,.]\d{3})*(?:\.\d+)?[KMB]?)/i);
                                if (numMatch) {
                                    reelData.views = parseMetric(numMatch[1]);
                                    break;
                                }
                            }
                        }
                    }
                    
                    // Extract comments
                    if (!reelData.comments) {
                        for (const pattern of patterns.comments) {
                            const match = pageText.match(pattern);
                            if (match) {
                                const numMatch = match[0].match(/(\d{1,3}(?:[,.]\d{3})*(?:\.\d+)?[KMB]?)/i);
                                if (numMatch) {
                                    reelData.comments = parseMetric(numMatch[1]);
                                    break;
                                }
                            }
                        }
                    }
                    
                    // Alternative: Try extracting from button attributes
                    if (!reelData.likes || !reelData.comments) {
                        const buttons = await page.$$('button, a');
                        for (const button of buttons) {
                            const ariaLabel = await page.evaluate((el: Element) => (el as HTMLElement).getAttribute('aria-label'), button);
                            if (ariaLabel) {
                                if (ariaLabel.includes('like') && !reelData.likes) {
                                    const likeMatch = ariaLabel.match(/(\d{1,3}(?:[,.]\d{3})*(?:\.\d+)?[KMB]?)/i);
                                    if (likeMatch) {
                                        reelData.likes = parseMetric(likeMatch[1]);
                                    }
                                }
                                if (ariaLabel.includes('comment') && !reelData.comments) {
                                    const commentMatch = ariaLabel.match(/(\d{1,3}(?:[,.]\d{3})*(?:\.\d+)?[KMB]?)/i);
                                    if (commentMatch) {
                                        reelData.comments = parseMetric(commentMatch[1]);
                                    }
                                }
                            }
                        }
                    }
                    
                } catch (e) {
                    console.log('Could not extract engagement metrics:', e);
                }
            }

            // Extract caption/description with better selectors
            if (!reelData.description) {
                try {
                    const captionSelectors = [
                        // Modern Instagram caption patterns
                        'article div[class*="caption"] span',
                        'div[data-testid="post-caption"] span',
                        'article div span[dir="auto"]',
                        // Legacy patterns
                        'article div div div div span',
                        'div._a9zs span',
                        'div[class*="_a9z"] span',
                        // Fallback to any span with substantial text in article
                        'article span'
                    ];
                    
                    for (const selector of captionSelectors) {
                        const elements = await page.$$(selector);
                        for (const element of elements) {
                            const caption = await page.evaluate((el: Element) => el.textContent, element);
                            if (caption && caption.trim().length > 10 && !caption.includes('likes') && !caption.includes('views')) {
                                reelData.description = caption.trim();
                                // Use first line as title if it's not too long
                                const firstLine = caption.split('\n')[0].trim();
                                if (firstLine.length <= 100 && firstLine.length > 3) {
                                    reelData.title = firstLine;
                                }
                                break;
                            }
                        }
                        if (reelData.description) break;
                    }
                } catch (e) {
                    console.log('Could not extract caption:', e);
                }
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