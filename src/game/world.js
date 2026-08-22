/**
 * Shared-world ownership cache — scalable + realtime.
 * - Viewport query: only properties whose center is in the current map bounds
 *   (for map coloring), instead of the whole table.
 * - For-sale query: all active listings (for the market browser).
 * - Supabase Realtime: any property change refreshes both, live (no polling).
 */
import { supabase } from '../lib/supabase.js';
import { bus, Events } from '../lib/event-bus.js';
import { getMarketUserId } from './market.js';

let viewport = [];  // properties in the current viewport (map coloring)
let forSale = [];   // active listings (market)
const byId = new Map();
const byBuilding = new Map();
let lastBounds = null;
let channel = null;
let refreshTimer = null;

export function startWorldSync() {
  fetchForSale();
  if (supabase && !channel) {
    channel = supabase
      .channel('world-properties')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'properties_toss' }, (payload) => {
        scheduleRefresh();
        detectNearbyTrade(payload);
      })
      .subscribe();
  }
}

// Called by the map on move (at building zoom) with the current bounds.
export function syncViewport(bounds) {
  lastBounds = bounds;
  doSyncViewport();
}

// Ambient "someone traded near you" toast (another player, within your view).
function detectNearbyTrade(payload) {
  if (payload.eventType !== 'UPDATE') return;
  const n = payload.new, o = payload.old;
  if (!n || !o || n.owner_id === o.owner_id || !n.owner_id) return;
  const me = getMarketUserId();
  if (n.owner_id === me || o.owner_id === me) return; // my own trade → handled elsewhere
  if (!lastBounds || n.center_lng == null) return;
  const b = lastBounds;
  if (n.center_lng < b.getWest() || n.center_lng > b.getEast() || n.center_lat < b.getSouth() || n.center_lat > b.getNorth()) return;
  bus.emit(Events.NEARBY_TRADE, { message: `💸 근처에서 "${n.name || '자산'}" 거래가 있었어요!` });
}

function scheduleRefresh() {
  if (refreshTimer) return;
  refreshTimer = setTimeout(() => { refreshTimer = null; doSyncViewport(); fetchForSale(); }, 400);
}

async function doSyncViewport() {
  if (!supabase || !lastBounds) return;
  const b = lastBounds;
  const { data, error } = await supabase
    .from('properties_toss')
    .select('id,kind,name,owner_id,for_sale,list_price,price,income_per_hour,meta,center_lng,center_lat')
    .gte('center_lng', b.getWest()).lte('center_lng', b.getEast())
    .gte('center_lat', b.getSouth()).lte('center_lat', b.getNorth())
    .limit(600);
  if (!error) { viewport = data || []; reindex(); bus.emit(Events.WORLD_UPDATED); }
}

async function fetchForSale() {
  if (!supabase) return;
  const { data, error } = await supabase
    .from('properties_toss')
    .select('id,kind,name,owner_id,for_sale,list_price,price,meta')
    .eq('for_sale', true).order('updated_at', { ascending: false }).limit(300);
  if (!error) { forSale = data || []; reindex(); bus.emit(Events.WORLD_UPDATED); }
}

export async function refreshWorld() {
  await Promise.all([doSyncViewport(), fetchForSale()]);
}

function baseBuildingId(p) {
  return p.meta?.buildingId || String(p.id).split('#')[0];
}
function reindex() {
  byId.clear();
  byBuilding.clear();
  for (const p of [...viewport, ...forSale]) if (!byId.has(p.id)) byId.set(p.id, p);
  for (const p of byId.values()) {
    const b = baseBuildingId(p);
    if (!byBuilding.has(b)) byBuilding.set(b, []);
    byBuilding.get(b).push(p);
  }
}

export const getProperty = (id) => byId.get(id) || null;
export const getBuildingProps = (id) => byBuilding.get(id) || [];
export const getAllProps = () => viewport;
export const getForSaleList = () => forSale;
