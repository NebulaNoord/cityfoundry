// Save-slot naming. One slot per city (name + seed), so saving again
// overwrites that city's slot and different cities never collide.
// 'autosave' is reserved by storage.js and never produced here.

export function slotForWorld(world) {
  const slug = String(world.name || 'city')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40);
  return `city-${slug || 'city'}-${world.seed}`;
}
