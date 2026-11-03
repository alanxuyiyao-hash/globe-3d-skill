/** Normalized rendering record. Input IDs are preserved separately from numeric picking IDs. */
export interface CyberEvent {
  id: number;
  recordId: string;
  type: string;
  lat: number;
  lng: number;
  city: string;
  country?: string;
  timestamp: number;
  hasTimestamp: boolean;
  intensity: number;
  source: string;
  title: string;
  description: string;
  url?: string;
}
