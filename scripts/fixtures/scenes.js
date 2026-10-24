import {designScenes, designFixtures} from './scenes-data.js';
export const scenes = designScenes;
export function sceneView(id) { return JSON.parse(JSON.stringify(designFixtures[id] || designFixtures['01'])); }
