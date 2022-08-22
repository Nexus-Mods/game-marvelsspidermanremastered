import axios from 'axios';
import path from 'path';
import { actions, fs, log, selectors, types, util } from 'vortex-api';

import { GAME_ID, TOOL_EXEC, TOOL_ID, SMPC_INFO, SMPCTool, MOD_EXT } from './common';

import { IFileInfo } from '@nexusmods/nexus-api';

const modInfo = 'Title=Vortex Merged Mod\n'
  + 'Author=Vortex\n'
  + 'Description=Contains one or more mods merged into one\n';

async function queryUser(api: types.IExtensionApi) {
  const t = api.translate;
  const browseForTool = async () => {
    const filePath = await api.selectExecutable({
      title: t('Select "{{toolExec}}"', { replace: { toolExec: TOOL_EXEC } }),
      filters: [{ name: TOOL_EXEC, extensions: ['exe'] }],
    });
    return filePath;
  };
  const result: types.IDialogResult = await api.showDialog('question', 'SMPC Modding Tool', {
    bbcode: t('"{{toolName}}" is required to successfully mod "Marvel\'s Spider-Man Remastered".{{lb}}'
            + 'Vortex can walk you through the download and installation of the tool.{{lb}}'
            + 'Alternatively if you already have the tool, please browse to the location of the tool\'s executable '
            + 'so that Vortex can find the "SMPCMods" folder.',
            { replace: { toolName: SMPCTool.name, lb: '[br][/br][br][/br]' } }),
  }, [
    { label: t('Cancel') },
    { label: t('Browse') },
    { label: t('Download and Install') },
  ]);
  
  if (result.action === 'Cancel') {
    return Promise.reject(new util.UserCanceled());
  } else if (result.action === 'Browse') {
    let filePath;
    while (!filePath) {
      filePath = await browseForTool();
      if (!filePath) {
        return Promise.reject(new util.UserCanceled());
      }
      if (path.basename(filePath).toLowerCase() !== TOOL_EXEC.toLowerCase()) {
        filePath = undefined;
      }
    }
    updateSMPCTool(api, filePath);
    if (!result || !result) {
      return Promise.reject(new util.UserCanceled());
    }
    return Promise.resolve(result[0]);
  } else {
    await downloadAndInstall(api);
  }
}

export async function ensureSMPC(api: types.IExtensionApi, discovery: types.IDiscoveryResult): Promise<void> {
  const state = api.getState();
  const mods = state.persistent.mods[GAME_ID] ?? {};
  const moddingTools: types.IMod[] = Object.values(mods).filter(m => m.type === 'smpc-modding-tool');
  const getUploadTime = (mod: types.IMod) => mod.attributes?.uploadedTimestamp ?? 0;
  const mod: types.IMod = moddingTools.reduce((prev, m) =>
    (prev === undefined)
      ? m
      : (getUploadTime(prev as any)) > (getUploadTime(m))
        ? prev
        : m, undefined);
  if (mod) {
    const staging = selectors.installPathForGame(state, GAME_ID);
    const modPath = path.join(staging, mod.installationPath, TOOL_EXEC);
    if (path.join(staging, mod.installationPath) !== discovery.tools?.[TOOL_ID].path) {
      updateSMPCTool(api, modPath);
    }
    return Promise.resolve();
  }
  const isDetected = !!discovery?.tools?.[TOOL_ID]?.path;
  if (isDetected) {
    try {
      await fs.statAsync(discovery.tools[TOOL_ID].path);
      return;
    } catch (err) {
      log('warn', 'SMPC path is invalid', err);
    }
  }

  await queryUser(api);
}

async function getLatestFileInfo(api: types.IExtensionApi, APIKEY: string): Promise<IFileInfo> {
  
  const response = await axios.get(`https://api.nexusmods.com/v1/games/${GAME_ID}/mods/51/files`, {
    headers: {
      apikey: APIKEY,
    }
  });
  return response.data.files[response.data.files.length - 1];
}

async function downloadPrem(api: types.IExtensionApi, fileInfo: IFileInfo, key: string): Promise<string> {
  const response = await axios.get(`https://api.nexusmods.com/v1/games/${GAME_ID}/mods/51/files/${fileInfo.file_id}/download_link`, {
    headers: { 
      apikey: key,
    }
  });
  const url = response.data[0].URI;
  return runDownload(api, fileInfo, url);
}

async function runDownload(api: types.IExtensionApi, fileInfo: IFileInfo, url: string) {
  return new Promise<string>((resolve, reject) => {
    api.events.emit('start-download', [url], {
      game: GAME_ID,
      source: 'nexus',
      name: fileInfo.name,
      nexus: {
        fileInfo,
      },
    },
    undefined,
    (err, downloadId) => (!!(err)
      ? reject(err)
      : resolve(downloadId)));
  });
}

async function downloadFree(api: types.IExtensionApi, fileInfo: IFileInfo): Promise<string> {
  util.opn(`https://www.nexusmods.com/${GAME_ID}/mods/51?tab=files&file_id=${fileInfo.file_id}&nmm=1`)
    .catch(err => null);
  return Promise.resolve(undefined);
  // const t = api.translate;
  // const instructions = t('Select the latest main file for "{{toolName}}"', { replace: { toolName: SMPCTool.name } });
  // return new Promise<string>((resolve, reject) => api.emitAndAwait('browse-for-download',
  //   `https://www.nexusmods.com/${GAME_ID}/mods/51?tab=files&file_id=${fileInfo.file_id}&nmm=1`, instructions)
  //     .then(async (result: string[]) => {
  //       if (!result || !result.length) {
  //         // If the user clicks outside the window without downloading.
  //         return reject(new util.UserCanceled());
  //       }
  //       if (!result[0].startsWith('SpiderManPCTool')) {
  //         return reject(new util.ProcessCanceled('Selected wrong download'));
  //       }
  //       try {
  //         const dlId = await runDownload(api, fileInfo, result[0]);
  //         return resolve(dlId);
  //       } catch (err) {
  //         return reject(err);
  //       }
  //     }));
}

async function downloadAndInstall(api: types.IExtensionApi) {
  const t = api.translate;
  const state = api.getState();
  const APIKEY = util.getSafe(state, ['confidential', 'account', 'nexus', 'APIKey'], '');
  if (!APIKEY) {
    return Promise.reject(new Error('No API key found'));
  }
  const autoInstall = util.getSafe(state, ['settings', 'automation', 'install'], false);
  if (autoInstall) {
    api.store.dispatch(actions.setAutoInstall(false));
  }
  const fileInfo: IFileInfo = await getLatestFileInfo(api, APIKEY);
  const isPremium = util.getSafe(state, ['persistent', 'nexus', 'userInfo', 'isPremium'], false);
  const downloads = util.getSafe(state, ['persistent', 'downloads', 'files'], {});
  let downloadId = Object.keys(downloads).find(id => downloads[id]?.modInfo?.nexus?.fileInfo?.file_id === fileInfo.file_id);
  if (isPremium) {
    downloadId = downloadId ?? await downloadPrem(api, fileInfo, APIKEY);
  } else {
    downloadId = downloadId ?? await downloadFree(api, fileInfo);
  }

  if (!downloadId) {
    // We can't reliably keep track of the free path, so can't auto install either :(
    return;
  }
  const modId = await install(api, downloadId);
  if (autoInstall) {
    api.store.dispatch(actions.setAutoInstall(true));
  }
  const profileId = selectors.lastActiveProfileForGame(api.getState(), GAME_ID);
  api.store.dispatch(actions.setModEnabled(profileId, modId, true));
  const staging = selectors.installPathForGame(api.getState(), GAME_ID);
  const execPath = path.join(staging, modId, TOOL_EXEC);
  updateSMPCTool(api, execPath);
}

async function install(api: types.IExtensionApi,
                       downloadId: string): Promise<string> {
  return new Promise<string>(async (resolve, reject) => {
    api.events.emit('start-install-download', downloadId, true, (err, modId) => {
      return (err) ? reject(err) : resolve(modId);
    });
  })
}

export function updateSMPCTool(api: types.IExtensionApi,
                               execPath: string) {
  api.store.dispatch(actions.addDiscoveredTool(GAME_ID, TOOL_ID, {
    ...SMPCTool,
    path: execPath,
    hidden: false,
    custom: false,
    defaultPrimary: false,
    workingDirectory: path.dirname(execPath),
  }, true));
}

export function makeTestMerge(api: types.IExtensionApi) {
  return (game, gameDiscovery) => {
    if (game.id !== GAME_ID) {
      return undefined;
    }

    return {
      baseFiles: () => [],
      filter: () => true,
    };
  }
}

let MERGED_PATHS = [];
export function resetMergedPaths() {
  MERGED_PATHS = [];
}
export function makeMerge(api: types.IExtensionApi) {
  return async (filePath, mergePath) => {
    const segments = filePath.split(path.sep);
    const modFilesIdx = segments.map(seg => seg.toLowerCase()).indexOf('modfiles');
    if (modFilesIdx === -1) {
      return;
    }

    const modFiles = segments.slice(0, modFilesIdx + 1).join(path.sep);
    if (MERGED_PATHS.includes(modFiles)) {
      return;
    } else {
      MERGED_PATHS.push(modFiles);
    }
    const szip = new util.SevenZip();
    const archivePath = path.join(mergePath, `VortexMergedMod${MOD_EXT}`);
    const arcExists = await fs.statAsync(archivePath).then(() => true, () => false);
    if (!arcExists) {
      const infoPath = path.join(mergePath, SMPC_INFO);
      await fs.writeFileAsync(infoPath, modInfo, { encoding: 'utf8' });
      await szip.add(archivePath, [ infoPath ], { raw: ['-r', '-tzip'] });
      await fs.removeAsync(infoPath);
      const game = util.getGame(GAME_ID);
      if (game?.extensionPath) {
        const vortexThumb = path.join(game.extensionPath, 'Thumbnail.png');
        await szip.add(archivePath, [ vortexThumb ], { raw: ['-r', '-tzip'] });
      }
    }
    await szip.add(archivePath, [ modFiles ], { raw: ['-r', '-tzip'] });
  }
}

export function runSMPCTool(api: types.IExtensionApi, toolPath: string) {
  api.sendNotification({
    type: 'activity',
    message: 'Running SMPCTool',
    id: 'running-spmctool',
  })
  return api.runExecutable(toolPath, ['-install'], { cwd: path.dirname(toolPath) })
    .catch(err => api.showErrorNotification('Failed to run tool', err,
      { allowReport: ['EPERM', 'EACCESS', 'ENOENT'].indexOf(err.code) !== -1 }))
    .finally(() => api.dismissNotification('running-spmctool'));
}

export function raiseSMPCNotif(api: types.IExtensionApi) {
  api.sendNotification({
    id: 'run-smpc-notif',
    type: 'info',
    title: 'Run Spider-Man PC Modding Tool',
    message: 'Please remember to run the SMPC Modding Tool to insert the mod files into the game archives.',
    allowSuppress: true,
    displayMS: 8000,
  });
}