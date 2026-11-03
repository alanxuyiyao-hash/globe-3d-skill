export const PALETTE = ['#ff567d', '#55ff9f', '#72c9ff', '#ffbf53', '#9d86ff', '#63e1da'];
export function categoryHex(category: string): string {
  let hash = 0;
  for (const character of category) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  return PALETTE[hash % PALETTE.length];
}
export const categoryColor = (category: string): number => parseInt(categoryHex(category).slice(1), 16);

export const GLOBE_RADIUS = 2;
export const GLOBE_SEGMENTS = 64;
export const ATMOSPHERE_OUTER_RADIUS = 2.18;
export const ATMOSPHERE_INNER_RADIUS = 2.10;
export const MARKER_RADIUS = 2.02;
export const GRID_RADIUS = 2.03;

export const GRID_COLOR = 0x00d4ff;
export const GRID_OPACITY = 0.15;

export const AUTO_ROTATE_SPEED = 0.0005;
export const ATMOSPHERE_ROTATE_SPEED = 0.0003;
export const STAR_ROTATE_SPEED = 0.00005;

export const MIN_ZOOM = 3;
export const MAX_ZOOM = 10;
export const MOUSE_ROTATE_FACTOR = 0.005;
export const MOUSE_ROTATE_LERP = 0.1;
export const ZOOM_LERP = 0.1;

export const EARTH_TEXTURE_URL = '/textures/earth-blue-marble.jpg';
