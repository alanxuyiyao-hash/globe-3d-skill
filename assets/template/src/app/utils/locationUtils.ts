import type { CyberEvent } from '../../types';

type LocationInput = Pick<CyberEvent, 'lat' | 'lng' | 'city' | 'country'>;

export interface ResolvedLocation {
  lat: number;
  lng: number;
  city: string;
  country: string;
  label: string;
  shortLabel: string;
  key: string;
  isApproximate: boolean;
}

export interface MarkerLocationLayout extends ResolvedLocation {
  clusterIndex: number;
  clusterSize: number;
  isLeader: boolean;
  locationCount: number;
  clusterAngle: number;
}

export interface LocationSummary extends ResolvedLocation {
  count: number;
  representativeEventId: number;
}

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

const toHumanCase = (value: string) => {
  const trimmed = value.trim();
  if (!trimmed) return '';
  if (trimmed === trimmed.toUpperCase()) {
    return trimmed
      .toLowerCase()
      .split(/\s+/)
      .map((part) => (part.length <= 3 ? part.toUpperCase() : `${part[0]?.toUpperCase() ?? ''}${part.slice(1)}`))
      .join(' ');
  }
  return trimmed;
};

const cleanLocationFragment = (value?: string | null) => {
  const normalized = String(value ?? '').trim();
  if (!normalized) return '';

  const unknownMatch = normalized.match(/^unknown\s*\((.+)\)$/i);
  if (unknownMatch) return toHumanCase(unknownMatch[1] ?? '');
  if (/^unknown$/i.test(normalized)) return '';

  return toHumanCase(normalized);
};

const formatCoordinateLabel = (lat: number, lng: number) => `${lat.toFixed(2)}, ${lng.toFixed(2)}`;

export const formatEventLocation = (event: Pick<CyberEvent, 'city' | 'country' | 'lat' | 'lng'>) => {
  const resolved = resolveDisplayLocation(event);
  return resolved.label;
};

export const resolveDisplayLocation = (event: LocationInput): ResolvedLocation => {
  const city = cleanLocationFragment(event.city);
  const country = cleanLocationFragment(event.country);

  const resolvedLabel = city && country && city.toLowerCase() !== country.toLowerCase()
    ? `${city}, ${country}`
    : city || country;

  const label = resolvedLabel || formatCoordinateLabel(event.lat, event.lng);
  return {
    lat: event.lat, lng: event.lng, city, country, label,
    shortLabel: city || country || formatCoordinateLabel(event.lat, event.lng),
    key: `${event.lat.toFixed(4)},${event.lng.toFixed(4)}`,
    isApproximate: false,
  };
};

export const buildMarkerLocationLayouts = (events: CyberEvent[]) => {
  const groups = new Map<string, { location: ResolvedLocation; events: CyberEvent[] }>();

  events.forEach((event) => {
    const location = resolveDisplayLocation(event);
    const current = groups.get(location.key);
    if (current) current.events.push(event);
    else groups.set(location.key, { location, events: [event] });
  });

  const layoutByEventId = new Map<number, MarkerLocationLayout>();
  const locations: LocationSummary[] = [];

  groups.forEach(({ location, events: groupedEvents }) => {
    locations.push({
      ...location,
      count: groupedEvents.length,
      representativeEventId: groupedEvents[0]?.id ?? -1,
    });

    groupedEvents.forEach((event, index) => {
      layoutByEventId.set(event.id, {
        ...location,
        clusterIndex: index,
        clusterSize: groupedEvents.length,
        isLeader: index === 0,
        locationCount: groupedEvents.length,
        clusterAngle: index * GOLDEN_ANGLE,
      });
    });
  });

  locations.sort((left, right) => right.count - left.count);

  return { layoutByEventId, locations };
};

export const countResolvedLocations = (events: CyberEvent[]) => buildMarkerLocationLayouts(events).locations.length;
