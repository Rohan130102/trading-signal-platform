/** The same colours as the web design system (docs/DESIGN_SYSTEM.md), so the product reads as one thing. */
export interface Palette {
  scheme: 'dark' | 'light';
  bg: string;
  surface: string;
  raised: string;
  text: string;
  muted: string;
  subtle: string;
  line: string;
  lineStrong: string;
  primary: string;
  primaryText: string;
  buy: string;
  sell: string;
  update: string;
  success: string;
  stop: string;
  buySoft: string;
  sellSoft: string;
  updateSoft: string;
  successSoft: string;
  stopSoft: string;
  neutralSoft: string;
}

export const dark: Palette = {
  scheme: 'dark',
  bg: '#0B0D10',
  surface: '#13161B',
  raised: '#1A1E24',
  text: '#ECEEF1',
  muted: '#A4ACB6',
  subtle: '#8A939E',
  line: 'rgba(255,255,255,0.08)',
  lineStrong: 'rgba(255,255,255,0.16)',
  primary: '#ECEEF1',
  primaryText: '#0B0D10',
  buy: '#5AA9FF',
  sell: '#EE7AB6',
  update: '#F0B341',
  success: '#3FCF8E',
  stop: '#FF6B6B',
  buySoft: 'rgba(90,169,255,0.13)',
  sellSoft: 'rgba(238,122,182,0.13)',
  updateSoft: 'rgba(240,179,65,0.13)',
  successSoft: 'rgba(63,207,142,0.13)',
  stopSoft: 'rgba(255,107,107,0.13)',
  neutralSoft: 'rgba(255,255,255,0.07)',
};

export const light: Palette = {
  scheme: 'light',
  bg: '#F6F7F8',
  surface: '#FFFFFF',
  raised: '#F1F2F4',
  text: '#14171B',
  muted: '#555D67',
  subtle: '#636B75',
  line: 'rgba(0,0,0,0.10)',
  lineStrong: 'rgba(0,0,0,0.22)',
  primary: '#14171B',
  primaryText: '#FFFFFF',
  buy: '#0B62C4',
  sell: '#B51E76',
  update: '#8F5B00',
  success: '#0B7A4B',
  stop: '#C4282D',
  buySoft: 'rgba(11,98,196,0.10)',
  sellSoft: 'rgba(181,30,118,0.10)',
  updateSoft: 'rgba(143,91,0,0.11)',
  successSoft: 'rgba(11,122,75,0.10)',
  stopSoft: 'rgba(196,40,45,0.10)',
  neutralSoft: 'rgba(0,0,0,0.05)',
};

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;
export const radius = { sm: 8, md: 12, lg: 16, pill: 999 } as const;
/** Smallest comfortable target, from Apple's and Google's guidance. */
export const TOUCH = 48;
