// ISO 3166-1 alpha-2 to alpha-3 country code mapping
export const ISO2_TO_ISO3: Record<string, string> = {
  AF: 'AFG', AL: 'ALB', DZ: 'DZA', AS: 'ASM', AD: 'AND', AO: 'AGO', AI: 'AIA',
  AQ: 'ATA', AG: 'ATG', AR: 'ARG', AM: 'ARM', AW: 'ABW', AU: 'AUS', AT: 'AUT',
  AZ: 'AZE', BS: 'BHS', BH: 'BHR', BD: 'BGD', BB: 'BRB', BY: 'BLR', BE: 'BEL',
  BZ: 'BLZ', BJ: 'BEN', BM: 'BMU', BT: 'BTN', BO: 'BOL', BA: 'BIH', BW: 'BWA',
  BR: 'BRA', BN: 'BRN', BG: 'BGR', BF: 'BFA', BI: 'BDI', KH: 'KHM', CM: 'CMR',
  CA: 'CAN', CV: 'CPV', KY: 'CYM', CF: 'CAF', TD: 'TCD', CL: 'CHL', CN: 'CHN',
  CO: 'COL', KM: 'COM', CG: 'COG', CD: 'COD', CR: 'CRI', CI: 'CIV', HR: 'HRV',
  CU: 'CUB', CY: 'CYP', CZ: 'CZE', DK: 'DNK', DJ: 'DJI', DM: 'DMA', DO: 'DOM',
  EC: 'ECU', EG: 'EGY', SV: 'SLV', GQ: 'GNQ', ER: 'ERI', EE: 'EST', ET: 'ETH',
  FJ: 'FJI', FI: 'FIN', FR: 'FRA', GA: 'GAB', GM: 'GMB', GE: 'GEO', DE: 'DEU',
  GH: 'GHA', GR: 'GRC', GL: 'GRL', GD: 'GRD', GT: 'GTM', GN: 'GIN', GW: 'GNB',
  GY: 'GUY', HT: 'HTI', HN: 'HND', HK: 'HKG', HU: 'HUN', IS: 'ISL', IN: 'IND',
  ID: 'IDN', IR: 'IRN', IQ: 'IRQ', IE: 'IRL', IL: 'ISR', IT: 'ITA', JM: 'JAM',
  JP: 'JPN', JO: 'JOR', KZ: 'KAZ', KE: 'KEN', KI: 'KIR', KP: 'PRK', KR: 'KOR',
  KW: 'KWT', KG: 'KGZ', LA: 'LAO', LV: 'LVA', LB: 'LBN', LS: 'LSO', LR: 'LBR',
  LY: 'LBY', LI: 'LIE', LT: 'LTU', LU: 'LUX', MO: 'MAC', MK: 'MKD', MG: 'MDG',
  MW: 'MWI', MY: 'MYS', MV: 'MDV', ML: 'MLI', MT: 'MLT', MH: 'MHL', MR: 'MRT',
  MU: 'MUS', MX: 'MEX', FM: 'FSM', MD: 'MDA', MC: 'MCO', MN: 'MNG', ME: 'MNE',
  MA: 'MAR', MZ: 'MOZ', MM: 'MMR', NA: 'NAM', NR: 'NRU', NP: 'NPL', NL: 'NLD',
  NZ: 'NZL', NI: 'NIC', NE: 'NER', NG: 'NGA', NO: 'NOR', OM: 'OMN', PK: 'PAK',
  PW: 'PLW', PA: 'PAN', PG: 'PNG', PY: 'PRY', PE: 'PER', PH: 'PHL', PL: 'POL',
  PT: 'PRT', PR: 'PRI', QA: 'QAT', RO: 'ROU', RU: 'RUS', RW: 'RWA', KN: 'KNA',
  LC: 'LCA', VC: 'VCT', WS: 'WSM', SM: 'SMR', ST: 'STP', SA: 'SAU', SN: 'SEN',
  RS: 'SRB', SC: 'SYC', SL: 'SLE', SG: 'SGP', SK: 'SVK', SI: 'SVN', SB: 'SLB',
  SO: 'SOM', ZA: 'ZAF', SS: 'SSD', ES: 'ESP', LK: 'LKA', SD: 'SDN', SR: 'SUR',
  SZ: 'SWZ', SE: 'SWE', CH: 'CHE', SY: 'SYR', TW: 'TWN', TJ: 'TJK', TZ: 'TZA',
  TH: 'THA', TL: 'TLS', TG: 'TGO', TO: 'TON', TT: 'TTO', TN: 'TUN', TR: 'TUR',
  TM: 'TKM', TV: 'TUV', UG: 'UGA', UA: 'UKR', AE: 'ARE', GB: 'GBR', US: 'USA',
  UY: 'URY', UZ: 'UZB', VU: 'VUT', VE: 'VEN', VN: 'VNM', YE: 'YEM', ZM: 'ZMB',
  ZW: 'ZWE', XK: 'XKX', PS: 'PSE', EH: 'ESH', NC: 'NCL', FK: 'FLK', TF: 'ATF',
}

// ISO 3166-1 alpha-3 to alpha-2 country code mapping (reverse of ISO2_TO_ISO3)
export const ISO3_TO_ISO2: Record<string, string> = Object.fromEntries(
  Object.entries(ISO2_TO_ISO3).map(([iso2, iso3]) => [iso3, iso2])
)

// ISO 3166-1 alpha-3 to country name mapping (from world-geo.json)
export const ISO3_TO_NAME: Record<string, string> = {
  AFG: 'Afghanistan', ALB: 'Albania', DZA: 'Algeria', AGO: 'Angola', ARG: 'Argentina',
  ARM: 'Armenia', AUS: 'Australia', AUT: 'Austria', AZE: 'Azerbaijan', BHS: 'Bahamas',
  BGD: 'Bangladesh', BLR: 'Belarus', BEL: 'Belgium', BLZ: 'Belize', BEN: 'Benin',
  BTN: 'Bhutan', BOL: 'Bolivia', BIH: 'Bosnia and Herzegovina', BWA: 'Botswana',
  BRA: 'Brazil', BRN: 'Brunei', BGR: 'Bulgaria', BFA: 'Burkina Faso', BDI: 'Burundi',
  KHM: 'Cambodia', CMR: 'Cameroon', CAN: 'Canada', CAF: 'Central African Republic',
  TCD: 'Chad', CHL: 'Chile', CHN: 'China', COL: 'Colombia', COG: 'Congo',
  COD: 'Democratic Republic of the Congo', CRI: 'Costa Rica', CIV: 'Ivory Coast',
  HRV: 'Croatia', CUB: 'Cuba', CYP: 'Cyprus', CZE: 'Czech Republic', DNK: 'Denmark',
  DJI: 'Djibouti', DOM: 'Dominican Republic', ECU: 'Ecuador', EGY: 'Egypt',
  SLV: 'El Salvador', GNQ: 'Equatorial Guinea', ERI: 'Eritrea', EST: 'Estonia',
  ETH: 'Ethiopia', FJI: 'Fiji', FIN: 'Finland', FRA: 'France', GAB: 'Gabon',
  GMB: 'Gambia', GEO: 'Georgia', DEU: 'Germany', GHA: 'Ghana', GRC: 'Greece',
  GRL: 'Greenland', GTM: 'Guatemala', GIN: 'Guinea', GNB: 'Guinea-Bissau',
  GUY: 'Guyana', HTI: 'Haiti', HND: 'Honduras', HUN: 'Hungary', ISL: 'Iceland',
  IND: 'India', IDN: 'Indonesia', IRN: 'Iran', IRQ: 'Iraq', IRL: 'Ireland',
  ISR: 'Israel', ITA: 'Italy', JAM: 'Jamaica', JPN: 'Japan', JOR: 'Jordan',
  KAZ: 'Kazakhstan', KEN: 'Kenya', PRK: 'North Korea', KOR: 'South Korea',
  KWT: 'Kuwait', KGZ: 'Kyrgyzstan', LAO: 'Laos', LVA: 'Latvia', LBN: 'Lebanon',
  LSO: 'Lesotho', LBR: 'Liberia', LBY: 'Libya', LTU: 'Lithuania', LUX: 'Luxembourg',
  MKD: 'Macedonia', MDG: 'Madagascar', MWI: 'Malawi', MYS: 'Malaysia', MLI: 'Mali',
  MRT: 'Mauritania', MEX: 'Mexico', MDA: 'Moldova', MNG: 'Mongolia', MNE: 'Montenegro',
  MAR: 'Morocco', MOZ: 'Mozambique', MMR: 'Myanmar', NAM: 'Namibia', NPL: 'Nepal',
  NLD: 'Netherlands', NZL: 'New Zealand', NIC: 'Nicaragua', NER: 'Niger',
  NGA: 'Nigeria', NOR: 'Norway', OMN: 'Oman', PAK: 'Pakistan', PAN: 'Panama',
  PNG: 'Papua New Guinea', PRY: 'Paraguay', PER: 'Peru', PHL: 'Philippines',
  POL: 'Poland', PRT: 'Portugal', QAT: 'Qatar', ROU: 'Romania', RUS: 'Russia',
  RWA: 'Rwanda', SAU: 'Saudi Arabia', SEN: 'Senegal', SRB: 'Serbia',
  SLE: 'Sierra Leone', SGP: 'Singapore', SVK: 'Slovakia', SVN: 'Slovenia',
  SLB: 'Solomon Islands', SOM: 'Somalia', ZAF: 'South Africa', SSD: 'South Sudan',
  ESP: 'Spain', LKA: 'Sri Lanka', SDN: 'Sudan', SUR: 'Suriname', SWZ: 'Swaziland',
  SWE: 'Sweden', CHE: 'Switzerland', SYR: 'Syria', TWN: 'Taiwan', TJK: 'Tajikistan',
  TZA: 'Tanzania', THA: 'Thailand', TLS: 'East Timor', TGO: 'Togo', TTO: 'Trinidad and Tobago',
  TUN: 'Tunisia', TUR: 'Turkey', TKM: 'Turkmenistan', UGA: 'Uganda', UKR: 'Ukraine',
  ARE: 'United Arab Emirates', GBR: 'United Kingdom', USA: 'United States',
  URY: 'Uruguay', UZB: 'Uzbekistan', VUT: 'Vanuatu', VEN: 'Venezuela', VNM: 'Vietnam',
  YEM: 'Yemen', ZMB: 'Zambia', ZWE: 'Zimbabwe', XKX: 'Kosovo', PSE: 'Palestine',
  NCL: 'New Caledonia', FLK: 'Falkland Islands', ATF: 'French Southern Territories',
}

// Convert ISO code (2-letter or 3-letter) to display name
export function getCountryName(isoCode: string): string {
  const code = isoCode.toUpperCase()
  // Check if it's already an ISO3 code
  if (ISO3_TO_NAME[code]) {
    return ISO3_TO_NAME[code]
  }
  // Try converting from ISO2 to ISO3
  const iso3 = ISO2_TO_ISO3[code]
  return iso3 ? ISO3_TO_NAME[iso3] || isoCode : isoCode
}
