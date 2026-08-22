class EventBus {
  constructor() {
    this.listeners = new Map();
  }

  on(event, callback) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event).add(callback);
    return () => this.off(event, callback);
  }

  off(event, callback) {
    const callbacks = this.listeners.get(event);
    if (callbacks) {
      callbacks.delete(callback);
    }
  }

  emit(event, data) {
    const callbacks = this.listeners.get(event);
    if (callbacks) {
      callbacks.forEach((cb) => cb(data));
    }
  }
}

export const bus = new EventBus();

// Event names
export const Events = {
  // Auth
  AUTH_STATE_CHANGED: 'auth:state_changed',
  AUTH_SIGNED_IN: 'auth:signed_in',
  AUTH_SIGNED_OUT: 'auth:signed_out',

  // Map
  MAP_LOADED: 'map:loaded',
  MAP_ZOOM_CHANGED: 'map:zoom_changed',
  MAP_CLICK: 'map:click',

  // Territory
  TERRITORY_SELECTED: 'territory:selected',
  TERRITORY_DESELECTED: 'territory:deselected',
  TERRITORY_PURCHASED: 'territory:purchased',
  TERRITORY_SOLD: 'territory:sold',
  TERRITORY_UPDATED: 'territory:updated',

  // Shared world (ownership / marketplace)
  WORLD_UPDATED: 'world:updated',
  NEARBY_TRADE: 'world:nearby_trade',

  // Travel / location
  TRAVEL_STARTED: 'travel:started',
  TRAVEL_ARRIVED: 'travel:arrived',
  LOCATION_CHANGED: 'travel:location_changed',

  // Game
  BALANCE_UPDATED: 'game:balance_updated',
  INCOME_RECEIVED: 'game:income_received',
  PRICE_CHANGED: 'game:price_changed',

  // UI
  PANEL_OPEN: 'ui:panel_open',
  PANEL_CLOSE: 'ui:panel_close',
  TOAST: 'ui:toast',
  MODAL_OPEN: 'ui:modal_open',
  MODAL_CLOSE: 'ui:modal_close',

  // Realtime
  REALTIME_TERRITORY_CHANGE: 'realtime:territory_change',
  REALTIME_NOTIFICATION: 'realtime:notification',
};
