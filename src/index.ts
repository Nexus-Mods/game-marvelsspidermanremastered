import { actions, fs, log, selectors, types, util } from 'vortex-api';

import { GAME_ID, SMPC_INFO, SMPCTool, MOD_EXT, TOOL_EXEC, getLOFilePath, getSMPCModPath, MM_GAME_ID, MM_PCTool, MOD_TYPE_ID, TOOL_TYPE_ID, MM_MOD_EXT, MM_TOOL_EXEC } from './common';
import { ensureSMPC, ensureSuitTool, makeMerge, makeTestMerge, resetMergedPaths, runSMPCTool, runSuitTool, updateSMPCTool } from './toolIntegration';
import { installSMPCTool, testSMPCTool, testSMPCMod, installSMPCMod, testSMPCModpack, installSMPCModpack } from './installers';
import path from 'path';

import SMPCAttribDashlet from './Attrib';
import { isModEnabled, isSpiderManGame } from './util';

const STEAM_ID = '1817070';
const EPIC_ID = 'be23672deb69402781cd47cc2919caf4';
const GAME_EXEC = 'Spider-Man.exe';

const MM_STEAM_ID = 1817190;
const MM_EPIC_NAME = 'Marvel\'s Spider-Man: Miles Morales';
const MM_GAME_EXEC = 'MilesMorales.exe';

async function findGame() {
  return util.GameStoreHelper.findByAppId([STEAM_ID, EPIC_ID])
    .then(game => game.gamePath);
}

async function prepareForModding(context: types.IExtensionContext, gameId: string, discovery: types.IDiscoveryResult) {
  await fs.ensureDirWritableAsync(path.join(discovery.path, getSMPCModPath(gameId)));
  try {
    await ensureSMPC(context.api, gameId, discovery);
  } catch (err) {
    if (!(err instanceof util.UserCanceled)) {
      throw err;
    }
  }
  try {
    await ensureSuitTool(context.api, gameId, discovery);
  } catch (err) {
    if (!(err instanceof util.UserCanceled)) {
      throw err;
    }
  }
}

function makeDeserializeLOFunction(api: types.IExtensionApi, gameId: string) {
  return async () => {
    const fileExt = gameId === GAME_ID ? MOD_EXT : MM_MOD_EXT;
    const discovery = selectors.discoveryByGame(api.getState(), gameId);
    const installFile = path.join(discovery.path, getLOFilePath());
    const modsBasePath = getSMPCModPath(gameId);
    const modsPath = path.join(discovery.path, modsBasePath);
    let lo: types.LoadOrder = [];
    const entries = await fs.readdirAsync(modsPath);
    const filtered: string[] = entries.filter((entry: string) => path.extname(entry) === fileExt);

    let manifest: types.IDeploymentManifest;
    try {
      manifest = await util.getManifest(api, '', gameId);
    } catch (err) {
      api.showErrorNotification('Failed to read deployment manifest', err);
      return [];
    }

    const managedMods: { [fileName: string]: string } = manifest.files
      .filter(file => util.isChildPath(file.relPath, modsBasePath))
      .reduce((prev, file) => {
        prev[path.basename(file.relPath).toLowerCase()] = file.source;
        return prev;
      }, {});
  
    // resolve id of mod containing a file - or undefined
    const resolveWithManifest = (filePath: string): string => managedMods[filePath.toLowerCase()];
  
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
        modId: entry === `VortexMergedMod${fileExt}` ? entry : resolveWithManifest(entry),
      }));
    } catch (err) {
      lo = filtered.map(entry => ({
        id: entry,
        enabled: true,
        name: entry,
        modId: entry === `VortexMergedMod${fileExt}` ? entry : resolveWithManifest(entry),
      }));
    }

    return Promise.resolve(lo);
  };
}

function makeSerializeLOFunction(api: types.IExtensionApi, gameId: string) {
  return async (loadOrder: types.LoadOrder) => {
    const state = api.getState();
    const discovery = selectors.discoveryByGame(state, gameId);
    const installFile = path.join(discovery.path, getLOFilePath());
    const entries = loadOrder.map(entry => `${entry.id},${entry.enabled ? '1' : '0'}`);
    const data = entries.join('\n');
    await fs.writeFileAsync(installFile, data, { encoding: 'utf8' });
    return Promise.resolve();
  }
}


function main(context: types.IExtensionContext) {
  let forceToolRun: boolean = false;
  context.registerGame({
    id: GAME_ID,
    name: 'Marvel\'s Spider-Man Remastered',
    logo: 'gameart.jpg',
    mergeMods: true,
    supportedTools: [SMPCTool],
    queryPath: findGame,
    queryModPath: () => '.',
    setup: (discovery) => prepareForModding(context, GAME_ID, discovery),
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

  context.registerGame({
    id: MM_GAME_ID,
    name: 'Marvel\'s Spider-Man: Miles Morales',
    logo: 'mm_gameart.jpg',
    mergeMods: true,
    supportedTools: [MM_PCTool],
    queryArgs: {
      steam: [{ id: MM_STEAM_ID.toString() }],
      epic: [{ name: MM_EPIC_NAME }],
    },
    queryModPath: () => '.',
    setup: (discovery) => prepareForModding(context, MM_GAME_ID, discovery),
    executable: () => MM_GAME_EXEC,
    requiredFiles: [
      MM_GAME_EXEC,
    ],
    environment: {
      SteamAppId: MM_STEAM_ID.toString(),
    },
    details: {
      steamAppId: MM_STEAM_ID,
      ignoreConflicts: [
        SMPC_INFO.toLowerCase(),
        'thumbnail.png',
      ],
    },
  });

  context.registerModType('smpc-modding-tool', 10, isSpiderManGame, (game: types.IGame) => {
    const state = context.api.getState();
    const discovery = selectors.discoveryByGame(state, game.id);
    return path.join(discovery.path, 'SMPCTool');
  }, () => Promise.resolve(false), { name: 'SMPC Modding Tool', deploymentEssential: true });
  context.registerModType(MOD_TYPE_ID, 15, isSpiderManGame, (game: types.IGame) => {
    const state = context.api.getState();
    const discovery = selectors.discoveryByGame(state, game.id);
    return path.join(discovery.path, getSMPCModPath(game.id));
  }, () => Promise.resolve(false), { name: 'SMPC Mod' });

  context.registerInstaller('smpc-tool-installer', 10,
    testSMPCTool,
    (files, destination, gameId) => installSMPCTool(context.api, files, destination, gameId));
  
  context.registerInstaller('smpc-mod-installer', 10,
    testSMPCMod,
    (files, destination, gameId) => installSMPCMod(context.api, files, destination, gameId));

  context.registerInstaller('smpc-modpack-installer', 5,
    testSMPCModpack,
    (files, destination, gameId) => installSMPCModpack(context.api, files, destination, gameId));

  context.registerMerge(makeTestMerge(context.api, GAME_ID), makeMerge(context.api, GAME_ID), MOD_TYPE_ID);
  context.registerMerge(makeTestMerge(context.api, MM_GAME_ID), makeMerge(context.api, MM_GAME_ID), MOD_TYPE_ID);

  context.registerAction('mod-icons', 300, 'open-ext', {},
                         'Open SMPC Mods Folder', () => {
    const state = context.api.getState();
    const discovery = selectors.currentGameDiscovery(state);
    const gameMode = selectors.activeGameId(state);
    const modsPath = path.join(discovery.path, getSMPCModPath(gameMode));
    util.opn(modsPath).catch(() => undefined);
  }, () => {
    const state = context.api.getState();
    const gameMode = selectors.activeGameId(state);
    return isSpiderManGame(gameMode);
  });

  context.registerDashlet('Spider-Man Modding Tool Attributions', 2, 1, 10, SMPCAttribDashlet, (state: types.IState) => {
    const gameMode = selectors.activeGameId(state);
    return isSpiderManGame(gameMode);
  }, undefined, { closable: false });

  const usageInstructions = 'This screen displays the order in which the SMPC tool is expected to load the mod assets into the game, higher index will get loaded last. '
      + 'By default Vortex only deploys one merged mod to the SMPCMods folder and will therefore generally be the only item in this list, unless other mods have been added manually. '
      + 'If no entries are present in the list, install some mods and make sure to deploy.';

  context.registerLoadOrder({
    gameId: GAME_ID,
    deserializeLoadOrder: makeDeserializeLOFunction(context.api, GAME_ID),
    serializeLoadOrder: makeSerializeLOFunction(context.api, GAME_ID),
    validate: () => undefined,
    toggleableEntries: true,
    usageInstructions,
  });

  context.registerLoadOrder({
    gameId: MM_GAME_ID,
    deserializeLoadOrder: makeDeserializeLOFunction(context.api, MM_GAME_ID),
    serializeLoadOrder: makeSerializeLOFunction(context.api, MM_GAME_ID),
    validate: () => undefined,
    toggleableEntries: true,
    usageInstructions,
  });

  context.once(() => {
    context.api.events.on('did-install-mod', (gameId: string, archiveId: string, modId: string) => {
      if (gameId !== GAME_ID) {
        return;
      }
      const state: types.IState = context.api.getState();
      const mod: types.IMod = util.getSafe(state.persistent.mods, [gameId, modId], undefined);
      // verify the mod installed is actually one required by this collection
      if (mod?.type === TOOL_TYPE_ID) {
        const discovery = selectors.discoveryByGame(state, GAME_ID);
        const execPath = path.join(discovery.path, 'SMPCTool', TOOL_EXEC);
        updateSMPCTool(context.api, gameId, execPath);
      }
    });

    context.api.onAsync('will-deploy', async (profileId) => {
      // on deployment, ensure the modding tool is installed
      const profile = selectors.profileById(context.api.getState(), profileId);
      if (!isSpiderManGame(profile?.gameId)) {
        return Promise.resolve();
      }
      const state = context.api.getState();
      const isPremium = util.getSafe(state, ['persistent', 'nexus', 'userInfo', 'isPremium'], false);
      if (!isPremium) {
        // We can't setup the modding tool before deployment as a free user since he needs
        //  to go through the website - no point in checking for SMPC.
        return Promise.resolve();
      }
      const mods = state.persistent.mods[profile.gameId] ?? {};
      const mod = Object.values(mods).find(m => m.type === TOOL_TYPE_ID);
      const discovery: types.IDiscoveryResult = selectors.discoveryByGame(context.api.getState(), profile.gameId);
      if (mod === undefined || !isModEnabled(context.api, profile.gameId, mod.id)) {
        try {
          await ensureSMPC(context.api, profile.gameId, discovery);
        } catch (err) {
          if (!(err instanceof util.UserCanceled)) {
            context.api.showErrorNotification('Failed to install SMPC', err);
          }
        }
      }
      return Promise.resolve();
    });

    context.api.onAsync('did-deploy',
        async (profileId: string, deployment: { [typeId: string]: types.IDeployedFile[] }, setTitle: (title: string) => void) => {

      const state = context.api.getState();
      const profile = selectors.profileById(state, profileId);
      if (!isSpiderManGame(profile?.gameId)) {
        return Promise.resolve();
      }
      context.api.dismissNotification('redundant-mods');
      const mods = util.getSafe(state, ['persistent', 'mods', profile.gameId], {});
      const enabledMods = Object.keys(mods).filter((key) =>
        (mods[key].type === MOD_TYPE_ID) && isModEnabled(context.api, profile.gameId, key));
      resetMergedPaths();
      const discovery = selectors.discoveryByGame(state, profile.gameId);
      const modsPath = path.join(discovery.path, getSMPCModPath(profile.gameId));
      if (!modsPath || (!forceToolRun && enabledMods.length === 0)) {
        return Promise.resolve();
      }
      forceToolRun = false;
      const toolExec = profile.gameId === GAME_ID ? TOOL_EXEC : MM_TOOL_EXEC;
      setTitle(context.api.translate('Running SMPC Tool'));
      try {
        await runSMPCTool(context.api, path.resolve(modsPath, '..', '..', toolExec));
      } catch (err) {
        log('warn', 'failed to run SMPC', err.message);
      }
      setTitle(context.api.translate('Running Suit Adder Tool'));
      try {
        await runSuitTool(context.api, profile.gameId, path.join(discovery.path, 'SMPCTool'), deployment);
      } catch (err) {
        log('warn', 'failed to run suit adder tool', err.message);
      }
    });

    context.api.onAsync('will-purge', async (profileId: string) => {
      const state = context.api.getState();
      const profile: types.IProfile = selectors.profileById(state, profileId);
      const discovery = selectors.discoveryByGame(state, profile.gameId);
      if (!isSpiderManGame(profile?.gameId) || (discovery?.path === undefined)) {
        return Promise.resolve();
      }
      const loFile = path.join(discovery.path, getLOFilePath());
      try {
        await fs.removeAsync(loFile);
      } catch (err) {
        // nop
      }

      const modsPath = path.join(discovery.path, getSMPCModPath(profile.gameId));
      const mods = util.getSafe(state, ['persistent', 'mods', profile.gameId], {});
      if (Object.keys(mods).length === 0) {
        return Promise.resolve();
      }
      const toolExec = profile.gameId === GAME_ID ? TOOL_EXEC : MM_TOOL_EXEC;
      await runSMPCTool(context.api, path.resolve(modsPath, '..', '..', toolExec));
      return Promise.resolve();
    });

    context.api.onAsync('did-remove-mods', (gameMode: string) => {
      const state = context.api.getState();
      const profileId = selectors.lastActiveProfileForGame(state, gameMode);
      const profile: types.IProfile = selectors.profileById(state, profileId);
      if (!isSpiderManGame(profile?.gameId)) {
        return Promise.resolve();
      }
      context.api.store.dispatch(actions.setDeploymentNecessary(profile.gameId, true));
      forceToolRun = true;
    });
  });

  return true;
}

export default main;
