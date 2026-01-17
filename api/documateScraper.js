import * as cheerio from 'cheerio';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const { urls } = req.body;
    if (!urls || !Array.isArray(urls)) return res.status(400).json({ error: "No URLs provided" });

    const results = await Promise.all(urls.slice(0, 10).map(async (url) => {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 6000);

        const response = await fetch(url, { 
            headers: { 
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
            },
            signal: controller.signal
        });
        clearTimeout(timeoutId);
        
        if (!response.ok) throw new Error(`Status ${response.status}`);
        
        const html = await response.text();
        const $ = cheerio.load(html);

        let author = "";
        let date = "";
        let site = "";
        let title = "";

        // --- 1. EXTRACT TITLE ---
        title = $('meta[property="og:title"]').attr('content') || 
                $('meta[name="twitter:title"]').attr('content') || 
                $('title').text() || 
                "";

        // --- 2. EXTRACT AUTHORS (Meta Tags) ---
        const authors = [];
        $('meta[name="citation_author"]').each((i, el) => {
            const val = $(el).attr('content');
            if (val && !authors.includes(val)) authors.push(val);
        });
        $('meta[name="dc.creator"]').each((i, el) => {
            const val = $(el).attr('content');
            if (val && !authors.includes(val)) authors.push(val);
        });
        
        // Fallback to standard author tag
        if (authors.length === 0) {
            const stdAuthor = $('meta[name="author"]').attr('content');
            if (stdAuthor) authors.push(stdAuthor);
        }

        if (authors.length > 0) author = authors.join(', ');

        // --- 3. EXTRACT DATE ---
        date = $('meta[name="citation_publication_date"]').attr('content') || 
               $('meta[name="citation_date"]').attr('content') || 
               $('meta[name="dc.date"]').attr('content') ||
               $('meta[name="date"]').attr('content') || 
               $('meta[property="article:published_time"]').attr('content');

        // --- 4. EXTRACT SITE NAME ---
        site = $('meta[property="og:site_name"]').attr('content') || 
               $('meta[name="citation_journal_title"]').attr('content');

        // --- 5. CLEAN TEXT EXTRACTION ---
        // Inject spaces to prevent word mashing
        $('br, div, p, h1, h2, h3, h4, li, tr').after(' ');
        
        // Remove junk elements
        $('script, style, nav, footer, svg, noscript, iframe, header, aside, button, .ad, .advertisement, .menu, .navigation').remove();
        
        let bodyText = $('body').text().replace(/\s+/g, ' ').trim();

        // --- 6. CONSTRUCT "RICH CONTENT" ---
        // We explicitly prepend the metadata to the content string.
        // This ensures the AI sees the author/date even if the raw text scrape is messy.
        
        let richContent = "";
        if (title) richContent += `Title: ${title}. `;
        if (author) richContent += `Author: ${author}. `;
        if (date) richContent += `Date: ${date}. `;
        if (site) richContent += `Source: ${site}. `;
        
        richContent += "\n\n" + bodyText.substring(0, 2000);

        return { 
            url, 
            status: "ok", 
            title: title || "", // Separate title field as requested
            meta: { 
                author: author || "", 
                date: date || "", 
                site: site || "" 
            }, 
            content: richContent // Content now includes the metadata header
        };

      } catch (e) {
        return { url, status: "failed", error: e.message };
      }
    }));

    return res.status(200).json({ results });

  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
