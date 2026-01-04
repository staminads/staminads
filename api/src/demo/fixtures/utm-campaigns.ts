export interface UtmCampaign {
  source: string;
  medium: string;
  campaign: string;
  content?: string;
  term?: string;
  channelGroup: string;
  durationMultiplier: number;
  weight: number;
}

export const UTM_CAMPAIGNS: UtmCampaign[] = [
  // Holiday Sale campaign with A/B creative testing
  {
    source: 'google',
    medium: 'cpc',
    campaign: 'holiday-sale',
    content: 'video-hero-v2',
    channelGroup: 'Paid Search',
    durationMultiplier: 2.2, // Winner
    weight: 5,
  },
  {
    source: 'google',
    medium: 'cpc',
    campaign: 'holiday-sale',
    content: 'carousel-products',
    channelGroup: 'Paid Search',
    durationMultiplier: 1.5,
    weight: 4,
  },
  {
    source: 'google',
    medium: 'cpc',
    campaign: 'holiday-sale',
    content: 'static-banner-v1',
    channelGroup: 'Paid Search',
    durationMultiplier: 0.7, // Underperformer
    weight: 3,
  },
  {
    source: 'google',
    medium: 'cpc',
    campaign: 'holiday-sale',
    content: 'static-banner-v2',
    channelGroup: 'Paid Search',
    durationMultiplier: 0.8,
    weight: 3,
  },

  // iPhone Launch campaign
  {
    source: 'google',
    medium: 'cpc',
    campaign: 'iphone-launch-2024',
    content: 'hands-on-demo',
    channelGroup: 'Paid Search',
    durationMultiplier: 2.5, // Best performer
    weight: 6,
  },
  {
    source: 'google',
    medium: 'cpc',
    campaign: 'iphone-launch-2024',
    content: 'spec-comparison',
    channelGroup: 'Paid Search',
    durationMultiplier: 1.8,
    weight: 4,
  },
  {
    source: 'google',
    medium: 'cpc',
    campaign: 'iphone-launch-2024',
    content: 'price-focus',
    channelGroup: 'Paid Search',
    durationMultiplier: 0.6, // Price shoppers leave quickly
    weight: 3,
  },

  // Facebook/Instagram social campaigns
  {
    source: 'facebook',
    medium: 'social',
    campaign: 'holiday-sale',
    content: 'lifestyle-video',
    channelGroup: 'Paid Social',
    durationMultiplier: 1.3,
    weight: 4,
  },
  {
    source: 'instagram',
    medium: 'social',
    campaign: 'holiday-sale',
    content: 'story-carousel',
    channelGroup: 'Paid Social',
    durationMultiplier: 0.9,
    weight: 4,
  },
  {
    source: 'instagram',
    medium: 'social',
    campaign: 'iphone-launch-2024',
    content: 'reel-unboxing',
    channelGroup: 'Paid Social',
    durationMultiplier: 1.4,
    weight: 3,
  },

  // Email campaigns
  {
    source: 'email',
    medium: 'email',
    campaign: 'newsletter-weekly',
    channelGroup: 'Email',
    durationMultiplier: 1.5, // Email subscribers are engaged
    weight: 5,
  },
  {
    source: 'email',
    medium: 'email',
    campaign: 'holiday-promo',
    content: 'gift-guide',
    channelGroup: 'Email',
    durationMultiplier: 1.6,
    weight: 3,
  },
  {
    source: 'email',
    medium: 'email',
    campaign: 'iphone-announcement',
    channelGroup: 'Email',
    durationMultiplier: 1.8,
    weight: 2,
  },

  // Display advertising
  {
    source: 'display',
    medium: 'display',
    campaign: 'retargeting',
    channelGroup: 'Display',
    durationMultiplier: 1.1,
    weight: 3,
  },
  {
    source: 'display',
    medium: 'display',
    campaign: 'awareness',
    channelGroup: 'Display',
    durationMultiplier: 0.7, // Cold traffic
    weight: 2,
  },

  // Affiliate campaigns
  {
    source: 'affiliate',
    medium: 'referral',
    campaign: 'tech-reviewers',
    channelGroup: 'Affiliate',
    durationMultiplier: 1.4,
    weight: 2,
  },

  // Back to school
  {
    source: 'google',
    medium: 'cpc',
    campaign: 'back-to-school',
    content: 'student-discount',
    term: 'macbook student',
    channelGroup: 'Paid Search',
    durationMultiplier: 1.3,
    weight: 3,
  },

  // WWDC
  {
    source: 'twitter',
    medium: 'social',
    campaign: 'wwdc-2024',
    channelGroup: 'Social',
    durationMultiplier: 1.6, // Developer audience
    weight: 2,
  },

  // AirPods promo
  {
    source: 'facebook',
    medium: 'social',
    campaign: 'airpods-promo',
    content: 'comparison-ad',
    channelGroup: 'Paid Social',
    durationMultiplier: 1.2,
    weight: 2,
  },
];

// Pre-compute total weight
export const UTM_CAMPAIGNS_TOTAL_WEIGHT = UTM_CAMPAIGNS.reduce(
  (sum, campaign) => sum + campaign.weight,
  0,
);

// iPhone launch specific campaigns
export const IPHONE_LAUNCH_CAMPAIGNS = UTM_CAMPAIGNS.filter(
  (c) => c.campaign === 'iphone-launch-2024',
);
export const IPHONE_LAUNCH_CAMPAIGNS_TOTAL_WEIGHT =
  IPHONE_LAUNCH_CAMPAIGNS.reduce((sum, c) => sum + c.weight, 0);

// No UTM placeholder (organic/direct traffic - majority)
export const NO_UTM_WEIGHT = 60; // 60% of traffic has no UTM
