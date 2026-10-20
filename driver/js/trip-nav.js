/**
 * Maps a trip's current workflow stage to the route that should handle it.
 * Shared by the bottom-tab "Current trip" shortcut and every "Continue" button.
 * @param {{id:string, stage:string}} trip
 * @returns {string} a hash route
 */
export function routeForTrip(trip) {
  switch (trip.stage) {
    case 'vehicle': return `#/trip/${trip.id}/vehicle`;
    case 'pretrip': return `#/trip/${trip.id}/pretrip`;
    case 'pickup': return `#/trip/${trip.id}/pickup`;
    case 'count': return `#/trip/${trip.id}/count`;
    case 'seal': return `#/trip/${trip.id}/seal`;
    case 'transit': return '#/map';
    case 'arrive': return `#/trip/${trip.id}/arrive`;
    case 'security': return `#/trip/${trip.id}/security`;
    case 'offload': return `#/trip/${trip.id}/offload`;
    case 'handover': return `#/trip/${trip.id}/handover`;
    case 'complete': return `#/trip/${trip.id}/complete`;
    default: return `#/trip/${trip.id}`;
  }
}
