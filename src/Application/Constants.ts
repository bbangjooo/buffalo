export const INNER_SITE_URL = "https://blog.bbangjo.kr";
export const SCALE = 870;
export const ASPECT = 1.683;

const SCREEN_HEIGHT = SCALE * 1.23;

export const SCREEN_SIZE = { w: SCREEN_HEIGHT * ASPECT, h: SCREEN_HEIGHT };
export const IFRAME_PADDING = 32;
export const IFRAME_SIZE = {
  w: SCREEN_SIZE.w - IFRAME_PADDING,
  h: SCREEN_SIZE.h - IFRAME_PADDING,
};
