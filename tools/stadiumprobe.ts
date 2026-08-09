#!/usr/bin/env tsx
/** Browser vertical-slice receipt for promoted and legacy stadium rendering. */
import { STADIUM_IDS } from '../src/data/stadiums.ts';
import { legacyTier3NativeEstimate } from '../src/render/stadiumVisual/index.ts';
import { ensureBuild, launch, startServer, stopServer } from './browser.ts';

interface Check { name: string; pass: boolean; detail: string }
const checks: Check[] = [];
function check(name: string, pass: boolean, detail = ''): void {
  checks.push({ name, pass, detail });
  console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${name.padEnd(52)} ${detail}`);
}

async function main(): Promise<void> {
  ensureBuild();
  console.log('\nMFD — authored stadium native-renderer probe\n────────────────────────────────────────────────────────────────');
  const url = await startServer(4178);
  const h = await launch(url, { width: 1280, height: 720 });
  const { page } = h;
  try {
    const venues = await page.evaluate(async (ids) => {
      const g = (window as unknown as { GO: any }).GO;
      g.settings.quality = 'LOW';
      g.settings.dynamicResolution = false;
      g.applySettings();
      const rows: Array<Record<string, unknown>> = [];
      for (const id of ids) {
        g.startMatch({ stadium: id, seed: 8080, quarterSeconds: 60 });
        const env = g.renderer.env;
        rows.push({
          id,
          built: !!env?.stadium?.group,
          authored: env?.stadium?.authored === true,
          hash: env?.stadium?.visualHash ?? '',
          crowd: env?.crowd?.count ?? 0,
          towers: env?.stadium?.towers?.length ?? 0,
          activeFraction: env?.stadium?.layout?.activeFraction ?? 1,
        });
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
      return rows;
    }, STADIUM_IDS);
    check('all 18 existing venues build', venues.length === 18 && venues.every((v) => v.built),
      `${venues.filter((v) => v.built).length}/18`);
    const saltpan = venues.find((v) => v.id === 'the-saltpan');
    check('the-saltpan resolves the promoted authored override', saltpan?.authored === true,
      String(saltpan?.hash ?? 'missing'));
    check('multiple venues remain on exact legacy fallback', venues.filter((v) => !v.authored).length >= 17,
      `${venues.filter((v) => !v.authored).length} legacy`);
    check('authored opening reduces the active bowl perimeter', Number(saltpan?.activeFraction) < 1,
      String(saltpan?.activeFraction));
    check('authored seat bands still produce one crowd system', Number(saltpan?.crowd) > 0,
      `count=${saltpan?.crowd}`);
    check('authored light towers reach the stadium handle', Number(saltpan?.towers) > 0,
      `towers=${saltpan?.towers}`);

    const dynamic = await page.evaluate(() => {
      const g = (window as unknown as { GO: any }).GO;
      // MEDIUM is the lowest tier that intentionally instantiates real tower spotlights; it keeps
      // the lighting assertion meaningful without paying HIGH's SwiftShader shader cost.
      g.settings.quality = 'MEDIUM';
      g.settings.dynamicResolution = false;
      g.applySettings();
      const match = g.startMatch({ stadium: 'the-saltpan', seed: 9090, quarterSeconds: 60 });
      const env = g.renderer.env;
      const liveBoard = env.stadium.group.getObjectByName('stadium.scoreboard.live') as any;
      const boardTexture = liveBoard?.material?.map ?? null;
      const before = boardTexture?.version ?? -1;
      // Drive the public renderer sync with the authoritative MatchState. This is the real game
      // path (Game.frame -> renderer.sync -> StadiumHandle.setScore), not a scoreboard shortcut.
      match.state.teams[0].score = 17;
      match.state.teams[1].score = 12;
      match.state.quarter = 3;
      match.state.clockTicks = 42 * 60;
      g.renderer.sync(match.world, match.state, 1, 0.6, false);
      const after = boardTexture?.version ?? -1;
      const lightGroup = g.renderer.scene.getObjectByName('env.light');
      let spots = 0;
      lightGroup?.traverse((object: any) => { if (object.isSpotLight) spots++; });
      const envBefore = g.renderer.env;
      g.endMatch();
      g.startMatch({ stadium: 'the-saltpan', seed: 9090, quarterSeconds: 60 });
      return {
        before, after, spots,
        sameKeyReused: envBefore === g.renderer.env,
        hash: g.renderer.env.stadium.visualHash,
        estimate: g.renderer.env.stadium.estimate,
      };
    });
    check('authored scoreboard canvas updates from live score plumbing', dynamic.after > dynamic.before,
      `texture version ${dynamic.before}→${dynamic.after}`);
    check('authored tower heads feed native spot lighting', dynamic.spots > 0, `spots=${dynamic.spots}`);
    check('same-key retry still reuses the scene', dynamic.sameKeyReused, String(dynamic.sameKeyReused));
    check('native authored build exposes compiler budget metadata',
      !!dynamic.estimate && dynamic.estimate.triangles > 0 && dynamic.estimate.drawCalls > 0,
      JSON.stringify(dynamic.estimate));

    const expectedLegacy = legacyTier3NativeEstimate('HIGH');
    const measuredLegacy = await page.evaluate(() => {
      const g = (window as unknown as { GO: any }).GO;
      g.settings.quality = 'HIGH';
      g.settings.dynamicResolution = false;
      g.applySettings();
      g.startMatch({ stadium: 'forgeworks-yard', seed: 6060, quarterSeconds: 60 });
      const group = g.renderer.env.stadium.group;
      const geometries = new Set<any>();
      const materials = new Set<any>();
      let drawCalls = 0;
      let triangles = 0;
      let vertices = 0;
      group.traverse((object: any) => {
        if (!object.isMesh || !object.geometry) return;
        const instances = object.isInstancedMesh ? object.count : 1;
        const geometry = object.geometry;
        const position = geometry.getAttribute('position');
        const indices = geometry.index?.count ?? position?.count ?? 0;
        triangles += (indices / 3) * instances;
        vertices += (position?.count ?? 0) * instances;
        geometries.add(geometry);
        const meshMaterials = Array.isArray(object.material) ? object.material : [object.material];
        for (const material of meshMaterials) {
          if (!material) continue;
          drawCalls++;
          materials.add(material);
        }
      });
      const textures = new Set<any>();
      for (const material of materials) {
        for (const value of Object.values(material)) {
          if ((value as any)?.isTexture) textures.add(value);
        }
      }
      return {
        triangles, vertices, drawCalls,
        staticGeometries: geometries.size,
        staticMaterials: materials.size,
        staticTextures: textures.size,
      };
    });
    const accountingKeys = [
      'triangles', 'vertices', 'drawCalls', 'staticGeometries', 'staticMaterials', 'staticTextures',
    ] as const;
    check('budget baseline equals measured native tier-3 fallback',
      accountingKeys.every((key) => measuredLegacy[key] === expectedLegacy[key])
        && measuredLegacy.staticMaterials === expectedLegacy.materialBatches,
      `${accountingKeys.map((key) => `${key}=${measuredLegacy[key]}/${expectedLegacy[key]}`).join(' ')}`
        + ` materialBatches=${measuredLegacy.staticMaterials}/${expectedLegacy.materialBatches}`);

    const lifecycle = await page.evaluate(async () => {
      const g = (window as unknown as { GO: any }).GO;
      g.settings.quality = 'LOW';
      g.settings.dynamicResolution = false;
      g.applySettings();
      g.endMatch();
      g.renderer.renderMenu(0); // settles the deferred unload before the baseline
      const unloaded: Array<{ geometries: number; textures: number }> = [];
      const loaded: Array<{ id: string; authored: boolean; geometries: number; textures: number }> = [];
      const ids = ['the-saltpan', 'forgeworks-yard', 'the-saltpan', 'forgeworks-yard',
        'the-saltpan', 'forgeworks-yard', 'the-saltpan', 'forgeworks-yard'];
      for (let i = 0; i < ids.length; i++) {
        const match = g.startMatch({ stadium: ids[i], seed: 9200 + i, quarterSeconds: 60 });
        g.renderer.sync(match.world, match.state, 1, 1 / 60, false);
        g.renderer.render();
        loaded.push({
          id: ids[i],
          authored: g.renderer.env?.stadium?.authored === true,
          geometries: g.renderer.renderer.info.memory.geometries,
          textures: g.renderer.renderer.info.memory.textures,
        });
        g.endMatch();
        g.renderer.renderMenu(i + 1); // forces deferred environment/registry disposal
        await new Promise((resolve) => setTimeout(resolve, 0));
        unloaded.push({
          geometries: g.renderer.renderer.info.memory.geometries,
          textures: g.renderer.renderer.info.memory.textures,
        });
      }
      return { loaded, unloaded };
    });
    const spread = (values: number[]): number => Math.max(...values) - Math.min(...values);
    const authoredLoads = lifecycle.loaded.filter((row) => row.authored);
    const legacyLoads = lifecycle.loaded.filter((row) => !row.authored);
    check('authored↔legacy cycles select both native paths',
      authoredLoads.length === 4 && legacyLoads.length === 4
        && authoredLoads.every((row) => row.id === 'the-saltpan')
        && legacyLoads.every((row) => row.id === 'forgeworks-yard'),
      `${authoredLoads.length} authored / ${legacyLoads.length} legacy`);
    check('authored reload geometry/texture counts stay stable',
      spread(authoredLoads.map((row) => row.geometries)) <= 2
        && spread(authoredLoads.map((row) => row.textures)) <= 2,
      `geo=${authoredLoads.map((row) => row.geometries).join('→')} tex=${authoredLoads.map((row) => row.textures).join('→')}`);
    check('legacy reload geometry/texture counts stay stable',
      spread(legacyLoads.map((row) => row.geometries)) <= 2
        && spread(legacyLoads.map((row) => row.textures)) <= 2,
      `geo=${legacyLoads.map((row) => row.geometries).join('→')} tex=${legacyLoads.map((row) => row.textures).join('→')}`);
    check('forced authored↔legacy unloads return to stable GPU memory',
      spread(lifecycle.unloaded.map((row) => row.geometries)) <= 2
        && spread(lifecycle.unloaded.map((row) => row.textures)) <= 2,
      `geo=${lifecycle.unloaded.map((row) => row.geometries).join('→')} tex=${lifecycle.unloaded.map((row) => row.textures).join('→')}`);

    const realErrors = h.errors.filter((error) =>
      !/favicon|WebGL: INVALID|deprecated/i.test(error));
    check('authored/legacy venue loads emit no page errors', realErrors.length === 0,
      realErrors.slice(0, 2).join(' | ') || 'clean');
  } finally {
    await h.close();
    stopServer();
  }
  const failed = checks.filter((item) => !item.pass).length;
  console.log(`────────────────────────────────────────────────────────────────\n${checks.length - failed}/${checks.length} stadium checks passed`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((error) => { console.error(error); stopServer(); process.exit(1); });
