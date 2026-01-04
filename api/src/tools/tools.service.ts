import { Inject, Injectable } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';
import * as cheerio from 'cheerio';
import * as crypto from 'crypto';
import sharp from 'sharp';
import { FaviconResult } from './dto/favicon.dto';
import { WebsiteMetaResponse } from './dto/website-meta.dto';

const FAVICON_FETCH_TIMEOUT = 10_000; // 10 seconds
const FAVICON_MAX_SIZE = 1_000_000; // 1MB
const FAVICON_TARGET_SIZE = 32; // 32x32 px
const USER_AGENT =
  'Mozilla/5.0 (compatible; StaminadsBot/1.0; +https://staminads.com)';

// 1x1 transparent PNG
const FALLBACK_IMAGE = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64',
);

type CheerioAPI = ReturnType<typeof cheerio.load>;

@Injectable()
export class ToolsService {
  constructor(@Inject(CACHE_MANAGER) private cacheManager: Cache) {}

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

  // ============================================
  // Favicon proxy methods
  // ============================================

  async getFavicon(urlString: string): Promise<FaviconResult> {
    // Validate URL
    const parsedUrl = this.validateUrl(urlString);
    if (!parsedUrl) {
      return { buffer: FALLBACK_IMAGE, contentType: 'image/png' };
    }

    // Check cache
    const cacheKey = this.createFaviconCacheKey(urlString);
    const cached = await this.cacheManager.get<FaviconResult>(cacheKey);
    if (cached) {
      // Reconstruct Buffer from cached data (cache-manager may serialize it)
      return {
        buffer: Buffer.from(cached.buffer),
        contentType: cached.contentType,
      };
    }

    try {
      // Determine favicon URL
      let faviconUrl: URL;

      if (this.isDirectImageUrl(parsedUrl)) {
        faviconUrl = parsedUrl;
      } else {
        // Fetch page and extract favicon URL
        const extractedUrl = await this.extractFaviconUrl(parsedUrl);
        if (extractedUrl) {
          faviconUrl = new URL(extractedUrl);
        } else {
          // Fallback to Google Favicon service
          faviconUrl = new URL(
            `https://www.google.com/s2/favicons?domain=${parsedUrl.hostname}&sz=256`,
          );
        }
      }

      // Fetch the image
      const { buffer, contentType, ok } = await this.fetchImage(faviconUrl);
      if (!ok || buffer.length === 0) {
        return { buffer: FALLBACK_IMAGE, contentType: 'image/png' };
      }

      // Process the image
      const { processedBuffer, processedContentType } = await this.processImage(
        buffer,
        faviconUrl.toString(),
        contentType,
      );

      const result: FaviconResult = {
        buffer: processedBuffer,
        contentType: processedContentType,
      };

      // Cache the result
      await this.cacheManager.set(cacheKey, result);

      return result;
    } catch {
      return { buffer: FALLBACK_IMAGE, contentType: 'image/png' };
    }
  }

  private validateUrl(urlString: string): URL | null {
    try {
      const url = new URL(urlString);
      if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        return null;
      }
      return url;
    } catch {
      return null;
    }
  }

  private createFaviconCacheKey(url: string): string {
    const hash = crypto.createHash('sha256').update(url).digest('hex');
    return `favicon:v1:${hash}`;
  }

  private isDirectImageUrl(url: URL): boolean {
    const imageExtensions = ['svg', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'ico'];
    return (
      imageExtensions.some((ext) =>
        url.pathname.toLowerCase().endsWith(`.${ext}`),
      ) || url.toString().includes('googleusercontent.com')
    );
  }

  private async extractFaviconUrl(pageUrl: URL): Promise<string | undefined> {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(
        () => controller.abort(),
        FAVICON_FETCH_TIMEOUT,
      );

      const response = await fetch(pageUrl.toString(), {
        headers: { 'User-Agent': USER_AGENT },
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (!response.ok) return undefined;

      const html = await response.text();
      const $ = cheerio.load(html);

      return this.findLogo($, pageUrl);
    } catch {
      return undefined;
    }
  }

  private async fetchImage(
    url: URL,
  ): Promise<{ buffer: Buffer; contentType: string; ok: boolean }> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FAVICON_FETCH_TIMEOUT);

    try {
      const response = await fetch(url.toString(), {
        redirect: 'follow',
        signal: controller.signal,
        headers: {
          'User-Agent': USER_AGENT,
          Accept: 'image/*,*/*;q=0.8',
        },
      });

      clearTimeout(timeout);

      if (!response.ok) {
        return {
          buffer: Buffer.alloc(0),
          contentType: 'text/plain',
          ok: false,
        };
      }

      // Check Content-Length header
      const contentLength = Number(response.headers.get('content-length') ?? 0);
      if (contentLength > FAVICON_MAX_SIZE) {
        return {
          buffer: Buffer.alloc(0),
          contentType: 'text/plain',
          ok: false,
        };
      }

      const arrayBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);

      // Double-check actual size
      if (buffer.length > FAVICON_MAX_SIZE) {
        return {
          buffer: Buffer.alloc(0),
          contentType: 'text/plain',
          ok: false,
        };
      }

      const contentType =
        response.headers.get('content-type') || 'application/octet-stream';

      return { buffer, contentType, ok: true };
    } catch {
      clearTimeout(timeout);
      return { buffer: Buffer.alloc(0), contentType: 'text/plain', ok: false };
    }
  }

  private isIcoFile(url: string, contentType: string): boolean {
    return url.toLowerCase().endsWith('.ico') || contentType === 'image/x-icon';
  }

  private isSvgFile(url: string, contentType: string): boolean {
    return (
      url.toLowerCase().endsWith('.svg') || contentType === 'image/svg+xml'
    );
  }

  private async processImage(
    buffer: Buffer,
    originalUrl: string,
    contentType: string,
  ): Promise<{ processedBuffer: Buffer; processedContentType: string }> {
    // ICO files: serve as-is
    if (this.isIcoFile(originalUrl, contentType)) {
      return { processedBuffer: buffer, processedContentType: 'image/x-icon' };
    }

    // SVG files: serve as-is
    if (this.isSvgFile(originalUrl, contentType)) {
      return {
        processedBuffer: buffer,
        processedContentType: 'image/svg+xml',
      };
    }

    // Small images: serve as-is
    if (buffer.length < 5000) {
      return { processedBuffer: buffer, processedContentType: contentType };
    }

    // Resize larger images to 32x32 PNG
    try {
      const resized = await sharp(buffer)
        .resize(FAVICON_TARGET_SIZE, FAVICON_TARGET_SIZE, { fit: 'cover' })
        .png()
        .toBuffer();

      return { processedBuffer: resized, processedContentType: 'image/png' };
    } catch {
      // If Sharp fails, return fallback
      return {
        processedBuffer: FALLBACK_IMAGE,
        processedContentType: 'image/png',
      };
    }
  }
}
