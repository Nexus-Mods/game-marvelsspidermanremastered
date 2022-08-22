import { fs, selectors, types, util } from 'vortex-api';

import { GAME_ID, SMPC_INFO, SMPCTool, MOD_EXT, TOOL_EXEC, LO_FILE } from './common';
import { ensureSMPC, makeMerge, makeTestMerge, resetMergedPaths, runSMPCTool, updateSMPCTool } from './smpcIntegration';
import { installSMPCTool, testSMPCTool, testSMPCMod, installSMPCMod } from './installers';
import path from 'path';

import SMPCAttribDashlet from './Attrib';

const STEAM_ID = '1817070';
const EPIC_ID = 'be23672deb69402781cd47cc2919caf4';
const GAME_EXEC = 'Spider-Man.exe';

async function findGame() {
  return util.GameStoreHelper.findByAppId([STEAM_ID, EPIC_ID])
    .then(game => game.gamePath);
}

function main(context: types.IExtensionContext) {
  context.registerGame({
    id: GAME_ID,
    name: 'Marvel\'s Spider-Man Remastered',
    logo: 'gameart.jpg',
    mergeMods: true,
    supportedTools: [SMPCTool],
    queryPath: findGame,
    queryModPath: () => '.',
    executable: () => GAME_EXEC,
    requiredFiles: [
      GAME_EXEC,
    ],
    environment: {
      SteamAPPId: STEAM_ID,
    },
    details: {
      steamAppId: +STEAM_ID,
      ignoreConflicts: [
        SMPC_INFO.toLowerCase(),
        'thumbnail.png',
      ],
    },
  });

  const getSMPCModPath = () => {
    const state = context.api.getState();
    const mods = state.persistent.mods[GAME_ID] ?? {};
    const mod: types.IMod = Object.values(mods).find(m => m.type === 'smpc-modding-tool');
    if (!mod) {
      const discovery = selectors.discoveryByGame(state, GAME_ID);
      if (!!discovery?.tools?.[SMPCTool.id]?.path) {
        return path.extname(discovery.tools[SMPCTool.id].path) === '.exe'
          ? path.join(path.dirname(discovery.tools[SMPCTool.id].path), 'ModManager', 'SMPCMods')
          : path.join(discovery.tools[SMPCTool.id].path, 'ModManager', 'SMPCMods');
      } else {
        return undefined;
      }
    } else {
      const staging = selectors.installPathForGame(state, GAME_ID);
      return path.join(staging, mod.installationPath, 'ModManager', 'SMPCMods');
    }
  };

  const getInstallFilePath = () => {
    const state = context.api.getState();
    const mods = state.persistent.mods[GAME_ID] ?? {};
    const mod: types.IMod = Object.values(mods).find(m => m.type === 'smpc-modding-tool');
    if (!mod) {
      const discovery = selectors.discoveryByGame(state, GAME_ID);
      if (!!discovery?.tools?.[SMPCTool.id]?.path) {
        return path.extname(discovery.tools[SMPCTool.id].path) === '.exe'
          ? path.join(path.dirname(discovery.tools[SMPCTool.id].path), 'ModManager', LO_FILE)
          : path.join(discovery.tools[SMPCTool.id].path, 'ModManager', LO_FILE);
      } else {
        return undefined;
      }
    } else {
      const staging = selectors.installPathForGame(state, GAME_ID);
      return path.join(staging, mod.installationPath, 'ModManager', LO_FILE);
    }
  }

  const isSpiderMan = (gameId: string) => gameId === GAME_ID;
  context.registerModType('smpc-modding-tool', 10, isSpiderMan, () => undefined, () => Promise.resolve(false), { name: 'SMPC Modding Tool', deploymentEssential: false });
  context.registerModType('smpc-mod', 15, isSpiderMan, getSMPCModPath, () => Promise.resolve(false), { name: 'SMPC Mod' });

  context.registerInstaller('smpc-tool-installer', 10,
    testSMPCTool,
    (files, destination, gameId) => installSMPCTool(context.api, files, destination, gameId));
  
  context.registerInstaller('smpc-mod-installer', 10,
    testSMPCMod,
    (files, destination) => installSMPCMod(context.api, files, destination));

  context.registerMerge(makeTestMerge(context.api), makeMerge(context.api), 'smpc-mod');

  context.registerAction('mod-icons', 300, 'open-ext', {},
                         'Open SMPC Mods Folder', () => {
    const modsPath = getSMPCModPath();
    if (modsPath) {
      util.opn(modsPath).catch(err => undefined);
    }
  });

  context.registerDashlet('Spider-Man Modding Tool Attributions', 2, 1, 10, SMPCAttribDashlet, (state: types.IState) => {
    const activeGameMode = selectors.activeGameId(state);
    return activeGameMode === GAME_ID;
  }, undefined, { closable: false });

  context.registerLoadOrder({
    gameId: GAME_ID,
    deserializeLoadOrder: async () => {
      const installFile = getInstallFilePath();
      const modsPath = getSMPCModPath();
      if (!modsPath || !installFile) {
        return [];
      }
      let lo: types.LoadOrder = [];
      const entries = await fs.readdirAsync(modsPath);
      const filtered = entries.filter(entry => path.extname(entry) === MOD_EXT);
      try {
        const data = await fs.readFileAsync(installFile, 'utf8');
        const entries = data.split('\n')
          .reduce((acc, l) => {
            const [mod, enabled] = l.split(',');
            acc[mod] = enabled === '1';
            return acc;
          }, {});
        lo = filtered.map(entry => ({
          id: entry,
          enabled: entries[entry] ?? true,
          name: entry,
          modId: entry === `VortexMergedMod${MOD_EXT}` ? entry : undefined,
        }));
      } catch (err) {
        lo = filtered.map(entry => ({
          id: entry,
          enabled: true,
          name: entry,
          modId: entry === `VortexMergedMod${MOD_EXT}` ? entry : undefined,
        }));
      }

      return Promise.resolve(lo);
    },
    serializeLoadOrder: async (loadOrder: types.LoadOrder) => {
      const installFile = getInstallFilePath();
      if (!installFile) {
        return;
      }
      const entries = loadOrder.map(entry => `${entry.id},${entry.enabled ? '1' : '0'}`);
      const data = entries.join('\n');
      await fs.writeFileAsync(installFile, data, { encoding: 'utf8' });
      return Promise.resolve();
    },
    validate: () => undefined,
    toggleableEntries: true,
    usageInstructions: 'This screen displays the order in which the SMPC tool is expected to load the mod assets into the game, higher index will get loaded last. '
      + 'By default Vortex only deploys one merged mod to the SMPCMods folder and will therefore generally be the only item in this list, unless other mods have been added manually. '
      + 'If no entries are present in the list, install some mods and make sure to deploy.',
  })

  const onPurge = (profileId: string) => {
    const state = context.api.getState();
    const profile = selectors.profileById(state, profileId);
    if (profile?.gameId !== GAME_ID) {
      return Promise.resolve();
    }
    
    const modsPath = getSMPCModPath();
    const mods = util.getSafe(state, ['persistent', 'mods', GAME_ID], {});
    if (!modsPath || Object.keys(mods).length === 0) {
      return Promise.resolve();
    }
    runSMPCTool(context.api, path.resolve(modsPath, '..', '..', TOOL_EXEC));
    return Promise.resolve();
  };

  context.once(() => {
    context.api.events.on('did-install-mod', (gameId: string, archiveId: string, modId: string) => {
      if (gameId !== GAME_ID) {
        return;
      }
      const state: types.IState = context.api.getState();
      const mod: types.IMod = util.getSafe(state.persistent.mods, [gameId, modId], undefined);
      // verify the mod installed is actually one required by this collection
      if (mod?.type === 'smpc-modding-tool') {
        const staging = selectors.installPathForGame(state, gameId);
        const execPath = path.join(staging, mod.installationPath, TOOL_EXEC);
        updateSMPCTool(context.api, execPath);
      }
    });

    context.api.onAsync('will-deploy', async (profileId, deployment) => {
      const profile = selectors.profileById(context.api.getState(), profileId);
      if (profile?.gameId !== GAME_ID) {
        return Promise.resolve();
      }
      let state = context.api.getState();
      let mods = state.persistent.mods[GAME_ID] ?? {};
      if (Object.keys(mods).length === 0) {
        return Promise.resolve();
      }
      let discovery = selectors.discoveryByGame(context.api.getState(), GAME_ID);
      try {
        await ensureSMPC(context.api, discovery);
        discovery = selectors.discoveryByGame(context.api.getState(), GAME_ID);
        if (!discovery?.tools?.[SMPCTool.id]?.path) {
          return Promise.reject(new Error('SMPC tool not found'));
        } else {
          const isInstalled = await fs.statAsync(discovery.tools[SMPCTool.id].path)
            .then(() => Promise.resolve(true))
            .catch(() => Promise.resolve(false));
          if (!isInstalled) {
            return Promise.reject(new Error('SMPC tool not found'));
          } else {
            let modsPath;
            state = context.api.getState();
            mods = state.persistent.mods[GAME_ID] ?? {};
            const mod: types.IMod = Object.values(mods).find(m => m.type === 'smpc-modding-tool');
            if (mod) {
              const staging = selectors.installPathForGame(state, GAME_ID);
              modsPath = path.join(staging, mod.installationPath, 'ModManager', 'SMPCMods');
            } else {
              modsPath = path.extname(discovery.tools[SMPCTool.id].path) === '.exe'
                ? path.join(path.dirname(discovery.tools[SMPCTool.id].path), 'ModManager', 'SMPCMods')
                : path.join(discovery.tools[SMPCTool.id].path, 'ModManager', 'SMPCMods');
            }
            await fs.ensureDirWritableAsync(modsPath);
          }
        }
      } catch (err) {
        return Promise.reject(err);
      }
      return Promise.resolve();
    });
    context.api.onAsync('did-deploy', async (profileId, deployment) => {
      const state = context.api.getState();
      const profile = selectors.profileById(state, profileId);
      if (profile?.gameId !== GAME_ID) {
        return Promise.resolve();
      }
      context.api.dismissNotification('redundant-mods');
      const mods = util.getSafe(state, ['persistent', 'mods', GAME_ID], {});
      const enabledMods = Object.keys(mods).filter((key) =>
        (mods[key].type === 'smpc-mod') && util.getSafe(profile, ['modState', key, 'enabled'], false));
      resetMergedPaths();
      const modsPath = getSMPCModPath();
      if (!modsPath || enabledMods.length === 0) {
        return Promise.resolve();
      }
      runSMPCTool(context.api, path.resolve(modsPath, '..', '..', TOOL_EXEC));
      return Promise.resolve();
    });

    context.api.onAsync('did-purge', async (profileId: string) => {
      const loFile = getInstallFilePath();
      if (!loFile) {
        return Promise.resolve();
      }
      try {
        await fs.removeAsync(loFile);
      } catch (err) {
        // nop
      }
      return onPurge(profileId);
    });

    context.api.onAsync('did-remove-mods', (gameMode: string) => {
      const state = context.api.getState();
      const profileId = selectors.lastActiveProfileForGame(state, gameMode);
      const profile = selectors.profileById(state, profileId);
      if (profile?.gameId !== GAME_ID) {
        return Promise.resolve();
      }
      return onPurge(profile.id)
    });
  });

  return true;
}

export default main;
