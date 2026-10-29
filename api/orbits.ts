// Deployment entry point; application logic remains in src/meteor_station/.
import { handleOrbitRequest } from '../src/meteor_station/server/orbits.js';
export default { fetch: handleOrbitRequest };
