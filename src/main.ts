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
            // Wait for the page to load (Puppeteer API)
            await page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 30000 }).catch(() => {});
            
            // Wait a bit more for dynamic content to load
            await page.waitForTimeout(3000);

            // Try to extract data using various selectors
            // Instagram frequently changes their selectors, so we'll try multiple approaches
            
            // Extract username
            try {
                const usernameSelectors = [
                    'article header div div div a',
                    'header a[role="link"]',
                    'a[href^="/"]',
                    'span._ap3a._aaco._aacw._aacx._aad7._aade'
                ];
                
                for (const selector of usernameSelectors) {
                    const usernameElement = await page.$(selector);
                    if (usernameElement) {
                        const username = await page.evaluate((el: Element) => el.textContent, usernameElement);
                        if (username && username.trim() && !username.includes('•')) {
                            reelData.username = username.trim();
                            break;
                        }
                    }
                }
            } catch (e) {
                console.log('Could not extract username:', e);
            }

            // Extract audio/music info
            try {
                const audioSelectors = [
                    '[aria-label*="Audio"]',
                    '[data-testid="audio-attribution"]',
                    'a[href*="/audio/"]'
                ];
                
                for (const selector of audioSelectors) {
                    const audioElement = await page.$(selector);
                    if (audioElement) {
                        const audio = await page.evaluate((el: Element) => el.textContent, audioElement);
                        if (audio && audio.trim()) {
                            reelData.audioUsed = audio.trim();
                            break;
                        }
                    }
                }
            } catch (e) {
                console.log('Could not extract audio info:', e);
            }

            // Extract engagement metrics (likes, comments, views)
            try {
                // Try to find engagement buttons/text
                const engagementSelectors = [
                    'button[aria-label*="like"]',
                    'button[aria-label*="comment"]',
                    'span:has-text(" likes")',
                    'span:has-text(" views")',
                    'div._ae5q._ae5r._ae5s'
                ];
                
                // Get all text content that might contain numbers
                const allText = await page.evaluate(() => document.body.textContent);
                
                // Extract likes using regex
                const likesMatch = allText?.match(/(\d{1,3}(?:,\d{3})*(?:\.\d+)?[KM]?)\s*likes?/i);
                if (likesMatch) {
                    reelData.likes = parseMetric(likesMatch[1]);
                }
                
                // Extract views using regex
                const viewsMatch = allText?.match(/(\d{1,3}(?:,\d{3})*(?:\.\d+)?[KM]?)\s*views?/i);
                if (viewsMatch) {
                    reelData.views = parseMetric(viewsMatch[1]);
                }
                
                // Extract comments - look for comment button or text
                const commentElements = await page.$$('button[aria-label*="comment"]');
                for (const element of commentElements) {
                    const text = await page.evaluate((el: Element) => el.textContent, element);
                    const commentMatch = text?.match(/(\d{1,3}(?:,\d{3})*(?:\.\d+)?[KM]?)\s*comments?/i);
                    if (commentMatch) {
                        reelData.comments = parseMetric(commentMatch[1]);
                        break;
                    }
                }
                
            } catch (e) {
                console.log('Could not extract engagement metrics:', e);
            }

            // Extract caption/description
            try {
                const captionSelectors = [
                    'article div div div div span',
                    '[data-testid="post-caption"]',
                    'div._a9zs span',
                    'h1'
                ];
                
                for (const selector of captionSelectors) {
                    const captionElement = await page.$(selector);
                    if (captionElement) {
                        const caption = await page.evaluate((el: Element) => el.textContent, captionElement);
                        if (caption && caption.trim() && caption.length > 10) {
                            reelData.description = caption.trim();
                            // Use first line as title if it's not too long
                            const firstLine = caption.split('\n')[0].trim();
                            if (firstLine.length <= 100) {
                                reelData.title = firstLine;
                            }
                            break;
                        }
                    }
                }
            } catch (e) {
                console.log('Could not extract caption:', e);
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

// Helper function to parse metrics like "1.2K", "500", "2.5M" into numbers
function parseMetric(value: string): number {
    const cleanValue = value.replace(/,/g, '').toUpperCase();
    const numericValue = parseFloat(cleanValue);
    
    if (cleanValue.includes('K')) {
        return Math.round(numericValue * 1000);
    } else if (cleanValue.includes('M')) {
        return Math.round(numericValue * 1000000);
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