import { create } from 'zustand';
import type { CyberEvent } from '../types';
interface GlobeStore {
  events: CyberEvent[];
  filters: { types: string[] };
  activeEventId: number | null;
  selectedEventId: number | null;
  timeline: number;
  setEvents: (events: CyberEvent[]) => void;
  setFilters: (filters: { types: string[] }) => void;
  setActiveEventId: (id: number | null) => void;
  setSelectedEventId: (id: number | null) => void;
  setTimeline: (value: number) => void;
}
export const useGlobeStore = create<GlobeStore>((set) => ({
  events: [], filters: { types: [] }, activeEventId: null, selectedEventId: null, timeline: 100,
  setEvents: (events) => set((state) => {
    const categories = [...new Set(events.map((event) => event.type))];
    const oldCategories = new Set(state.events.map((event) => event.type));
    const wasAll = oldCategories.size === state.filters.types.length;
    return {
      events, filters: { types: wasAll ? categories : categories.filter((type) => state.filters.types.includes(type) || !oldCategories.has(type)) },
      activeEventId: null, selectedEventId: null,
    };
  }),
  setFilters: (filters) => set({ filters }),
  setActiveEventId: (activeEventId) => set({ activeEventId }),
  setSelectedEventId: (selectedEventId) => set({ selectedEventId }),
  setTimeline: (timeline) => set({ timeline }),
}));
