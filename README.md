# Instagram Reel Scraper

This Apify Actor scrapes metadata from Instagram reels including username, audio used, engagement metrics (likes, views, comments), and captions.

## Why Playwright instead of Axios + Cheerio?

Instagram is a single-page application (SPA) that loads content dynamically with JavaScript. Traditional HTTP scraping with axios and cheerio won't work because:

1. **JavaScript Rendering Required**: Instagram's content is loaded after the initial page load via JavaScript API calls
2. **Anti-Bot Protection**: Instagram has sophisticated bot detection systems
3. **Dynamic Content**: The HTML structure changes frequently and content is generated client-side
4. **Authentication Requirements**: Many endpoints require tokens and session data

Playwright solves these issues by:
- Rendering JavaScript like a real browser
- Handling dynamic content loading
- Better at avoiding detection when configured properly
- Can wait for content to load and interact with the page

## Features

Extracts the following data from Instagram reels:
- **Username**: The account that posted the reel
- **Audio Used**: Music or audio track information
- **Engagement Metrics**: 
  - Number of likes
  - Number of views 
  - Number of comments
- **Content**: 
  - Title (first line of caption)
  - Description (full caption text)

## Input

The actor accepts a single Instagram reel URL:

```json
{
  "url": "https://www.instagram.com/reel/DBY2nwzpK9V/"
}
```

## Output

Example output:

```json
{
  "username": "example_user",
  "audioUsed": "Original audio",
  "likes": 1500,
  "views": 25000,
  "comments": 89,
  "title": "Amazing sunset view!",
  "description": "Amazing sunset view! 🌅 #sunset #nature #beautiful",
  "url": "https://www.instagram.com/reel/DBY2nwzpK9V/"
}
```

## Installation

1. Install dependencies:
   ```bash
   npm install
   ```

2. Install Playwright browsers:
   ```bash
   npx playwright install chromium
   ```

## Development

```bash
# Run locally
npm start

# Build for production
npm run build

# Run production build
npm run start:prod
```

## Notes

- Instagram frequently changes their HTML structure, so the selectors may need updates
- The scraper includes multiple fallback selectors for better reliability
- Rate limiting and IP blocking may occur with heavy usage
- Some metrics may not be available for private accounts or certain posts

## Troubleshooting

- If no data is extracted, Instagram may have changed their selectors
- Check the logs for specific error messages
- Ensure the URL is a valid Instagram reel URL
- Consider using delays between requests to avoid rate limiting

## Documentation reference

To learn more about Apify and Actors, take a look at the following resources:

- [Apify SDK for JavaScript documentation](https://docs.apify.com/sdk/js)
- [Apify SDK for Python documentation](https://docs.apify.com/sdk/python)
- [Apify Platform documentation](https://docs.apify.com/platform)
- [Join our developer community on Discord](https://discord.com/invite/jyEM2PRvMU)