import { Injectable } from '@nestjs/common';
import * as cheerio from 'cheerio';
import { WebsiteMetaResponse } from './dto/website-meta.dto';

type CheerioAPI = ReturnType<typeof cheerio.load>;

@Injectable()
export class ToolsService {
  async getWebsiteMeta(url: string): Promise<WebsiteMetaResponse> {
    const response = await fetch(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (compatible; StaminadsBot/1.0; +https://staminads.com)',
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch URL: ${response.status}`);
    }

    const html = await response.text();
    const $ = cheerio.load(html);
    const baseUrl = new URL(url);

    const result: WebsiteMetaResponse = {};

    // Extract title
    result.title = this.findTitle($);

    // Extract logo (favicon/icon)
    result.logo_url = await this.findLogo($, baseUrl);

    return result;
  }

  private findTitle($: CheerioAPI): string | undefined {
    // Try og:title first
    const ogTitle = $('meta[property="og:title"]').attr('content');
    if (ogTitle) return ogTitle.trim();

    // Then regular title tag
    const title = $('title').text();
    if (title) return title.trim();

    return undefined;
  }

  private async findLogo(
    $: CheerioAPI,
    baseUrl: URL,
  ): Promise<string | undefined> {
    // 1. Apple touch icon (usually high quality)
    const appleTouchIcon = $('link[rel="apple-touch-icon"]').attr('href');
    if (appleTouchIcon) {
      return this.resolveUrl(baseUrl, appleTouchIcon);
    }

    // 2. Large icon from link tags
    const iconLink = $('link[rel="icon"][sizes]').toArray();
    let largestIcon: { href: string; size: number } | null = null;

    for (const el of iconLink) {
      const href = $(el).attr('href');
      const sizes = $(el).attr('sizes');
      if (href && sizes) {
        const size = parseInt(sizes.split('x')[0], 10) || 0;
        if (!largestIcon || size > largestIcon.size) {
          largestIcon = { href, size };
        }
      }
    }

    if (largestIcon) {
      return this.resolveUrl(baseUrl, largestIcon.href);
    }

    // 3. Regular favicon
    const favicon =
      $('link[rel="icon"]').attr('href') ||
      $('link[rel="shortcut icon"]').attr('href');
    if (favicon) {
      return this.resolveUrl(baseUrl, favicon);
    }

    // 4. Try manifest.json for icons
    const manifestHref = $('link[rel="manifest"]').attr('href');
    if (manifestHref) {
      const manifestIcon = await this.findManifestIcon(baseUrl, manifestHref);
      if (manifestIcon) return manifestIcon;
    }

    // 5. Default /favicon.ico
    const defaultFavicon = this.resolveUrl(baseUrl, '/favicon.ico');
    try {
      const res = await fetch(defaultFavicon, { method: 'HEAD' });
      if (res.ok) return defaultFavicon;
    } catch {
      // ignore
    }

    return undefined;
  }

  private async findManifestIcon(
    baseUrl: URL,
    manifestHref: string,
  ): Promise<string | undefined> {
    try {
      const manifestUrl = this.resolveUrl(baseUrl, manifestHref);
      const res = await fetch(manifestUrl);
      if (!res.ok) return undefined;

      const manifest = (await res.json()) as {
        icons?: Array<{ src: string; sizes?: string }>;
      };

      if (!manifest.icons?.length) return undefined;

      // Find largest icon
      let largest: { src: string; size: number } | null = null;
      for (const icon of manifest.icons) {
        const size = icon.sizes ? parseInt(icon.sizes.split('x')[0], 10) : 0;
        if (!largest || size > largest.size) {
          largest = { src: icon.src, size };
        }
      }

      if (largest) {
        return this.resolveUrl(baseUrl, largest.src);
      }
    } catch {
      // ignore manifest errors
    }
    return undefined;
  }

  private resolveUrl(baseUrl: URL, href: string): string {
    // Handle absolute URLs
    if (href.startsWith('http://') || href.startsWith('https://')) {
      return href;
    }

    // Handle protocol-relative URLs
    if (href.startsWith('//')) {
      return `${baseUrl.protocol}${href}`;
    }

    // Resolve relative URLs
    return new URL(href, baseUrl).toString();
  }
}
