import path from 'path';
import { actions, fs, log, selectors, types, util } from 'vortex-api';

import { GAME_ID, TOOL_EXEC, TOOL_ID, SMPC_INFO, SMPCTool, MOD_EXT, getSMPCModPath, TOOL_TYPE_ID, MM_MOD_EXT, MM_TOOL_EXEC, TOOL_PAGE_ID, MM_TOOL_PAGE_ID, SUIT_TOOL_PAGE_ID, MM_SUIT_TOOL_PAGE_ID, SUIT_TOOL_EXEC, SUIT_TOOL_ID } from './common';
import { isModEnabled } from './util';

import { IFileInfo } from '@nexusmods/nexus-api';

const modInfo = 'Title=Vortex Merged Mod\n'
  + 'Author=Vortex\n'
  + 'Description=Contains one or more mods merged into one\n';

async function queryUser(api: types.IExtensionApi, gameId: string) {
  const result: types.IDialogResult = await api.showDialog('question', 'SMPC Modding Tool', {
    bbcode: '"{{toolName}}" is required to successfully mod "Marvel\'s Spider-Man Remastered".{{lb}}'
            + 'Vortex can walk you through the download and installation of the tool.',
    parameters: { toolName: SMPCTool.name, lb: '[br][/br][br][/br]' },
  }, [
    { label: 'Cancel' },
    { label: 'Download and Install' },
  ]);
  
  if (result.action === 'Cancel') {
    return Promise.reject(new util.UserCanceled());
  } else {
    const nexusModId: number = gameId === GAME_ID ? TOOL_PAGE_ID : MM_TOOL_PAGE_ID;
    const modId = await downloadAndInstall(api, gameId, nexusModId);
    const staging = selectors.installPathForGame(api.getState(), gameId);
    const toolExec = gameId === GAME_ID ? TOOL_EXEC : MM_TOOL_EXEC;
    const execPath = path.join(staging, modId, toolExec);
    // TODO: this configures the tool to be run from the staging folder. Do we even have to deploy it then?
    updateSMPCTool(api, gameId, execPath);
  }
}

async function querySuitTool(api: types.IExtensionApi, gameId: string) {
  const result: types.IDialogResult = await api.showDialog('question', 'Suit Tool', {
    bbcode: 'You likely want "Suit Adder Tool" by ASC as it\'s required to install suit mods that install to a separate '
      + 'slot instead of replacing an existing suit. (Vortex will run this tool automatically).',
  }, [
    { label: 'Cancel' },
    { label: 'Download and Install' },
  ]);
  
  if (result.action === 'Cancel') {
    return Promise.reject(new util.UserCanceled());
  } else {
    const nexusModId: number = gameId === GAME_ID ? SUIT_TOOL_PAGE_ID : MM_SUIT_TOOL_PAGE_ID;
    // this tool is distributed directly as an exe so let's not use the regular installation mechanism
    const { downloadId, version } = await download(api, gameId, nexusModId);

    const state = api.getState();
    const downloadInfo = state.persistent.downloads.files[downloadId];

    const mod: types.IMod = {
      id: SUIT_TOOL_ID,
      archiveId: downloadId,
      state: 'installed',
      attributes: {
        ...(downloadInfo.modInfo ?? {}),
        name: 'Suit Adder Tool',
        logicalFileName: 'Suit Adder Tool',
        source: 'nexus',
        modId: nexusModId,
        fileId: downloadInfo.modInfo?.fileId ?? downloadInfo.modInfo?.nexus?.ids?.fileId,
        version,
        installTime: new Date(),
      },
      installationPath: SUIT_TOOL_ID,
      type: '',
    };

    await util.toPromise(cb => api.events.emit('create-mod', gameId, mod, cb));

    const downloadPath = selectors.downloadPathForGame(state, gameId);
    const stagingPath = selectors.installPathForGame(state, gameId);
    const profileId = selectors.lastActiveProfileForGame(state, gameId);

    const modBasePath = path.join(stagingPath, SUIT_TOOL_ID, 'SMPCTool');
    await fs.ensureDirWritableAsync(modBasePath);
    await fs.copyAsync(path.join(downloadPath, downloadInfo.localPath), path.join(modBasePath, SUIT_TOOL_EXEC));
    await fs.writeFileAsync(path.join(modBasePath, 'lang.txt'), 'en', { encoding: 'utf-8' });
    api.store.dispatch(actions.setModEnabled(profileId, mod.id, true));
    api.store.dispatch(actions.setDeploymentNecessary(gameId, true));
  }
}

export async function checkToolInstalled(api: types.IExtensionApi, gameId: string, execPath: string, nexusModId: number) {
  const state = api.getState();
  const mods = state.persistent.mods[gameId] ?? {};
  const profileId = selectors.lastActiveProfileForGame(state, gameId);

  const moddingTools: types.IMod[] = Object.values(mods).filter(m =>
    m.attributes.modId === nexusModId);
  const enabledTools = moddingTools.filter(m => isModEnabled(api, gameId, m.id));

  const getUploadTime = (mod: types.IMod) => mod.attributes?.uploadedTimestamp ?? 0;

  if (enabledTools.length > 0) {
    // if there already is an enabled version of the SMPC tool, we use that, just make sure it's deployed
    try {
      await fs.statAsync(execPath);
    } catch (err) {
      api.store.dispatch(actions.setDeploymentNecessary(gameId, true));
    }
    return true;
  } else if (moddingTools.length > 0) {
    // if there are copies of the tool installed but not enabled, silently enable the latest one
    const mod: types.IMod = moddingTools.reduce((prev, tool) =>
      ((prev === undefined) || (getUploadTime(tool) > getUploadTime(prev)))
      ? tool 
      : prev, undefined);
    api.store.dispatch(actions.setModEnabled(profileId, mod.id, true));
    return true;
  } else {
    // if there are no installed versions of the tool, ask the user to install it
    return false;
  }
}

export async function ensureSMPC(api: types.IExtensionApi, gameId: string, discovery: types.IDiscoveryResult): Promise<void> {
  const toolExec = gameId === GAME_ID ? TOOL_EXEC : MM_TOOL_EXEC;
  const modId = gameId === GAME_ID ? TOOL_PAGE_ID : MM_TOOL_PAGE_ID;
  const execPath = path.join(discovery.path, 'SMPCTool', toolExec);

  if (await checkToolInstalled(api, gameId, execPath, modId)) {
    updateSMPCTool(api, gameId, execPath);
  } else {
    await queryUser(api, gameId);
  }
}

export async function ensureSuitTool(api: types.IExtensionApi, gameId: string, discovery: types.IDiscoveryResult): Promise<void> {
  const toolExec = SUIT_TOOL_EXEC;
  const modId = gameId === GAME_ID ? SUIT_TOOL_PAGE_ID : MM_SUIT_TOOL_PAGE_ID;
  const execPath = path.join(discovery.path, "SMPCTool", toolExec);

  if (!await checkToolInstalled(api, gameId, execPath, modId)) {
    await querySuitTool(api, gameId);
  }
}

async function download(api: types.IExtensionApi, gameId: string, nexusModId: number) {
  // this requires vortex 1.7
  // const modFiles: IFileInfo[] = await api.ext.nexusGetModFiles(gameId, nexusModId);

  const modFiles: IFileInfo[] = (await api.emitAndAwait('get-mod-files', gameId, nexusModId))[0];
  const fileTime = (input: IFileInfo) => Number.parseInt(input.uploaded_time, 10);

  const latestFile: IFileInfo = modFiles
    .filter(file => file.category_id === 1)
    .sort((lhs, rhs) => fileTime(lhs) - fileTime(rhs))[0];

  const state = api.getState();

  // download the latest file, unless we already have it
  const downloads = state.persistent.downloads.files;
  let downloadId = Object.keys(downloads).find(id => downloads[id]?.modInfo?.nexus?.fileInfo?.file_id === latestFile.file_id);
  if (downloadId === undefined) {
    // requires vortex 1.7
    // downloadId = await (api.ext.nexusDownload as any)(gameId, nexusModId, latestFile.file_id, undefined, false);
    downloadId = (await api.emitAndAwait('nexus-download', gameId, nexusModId, latestFile.file_id, undefined, false))[0];
  }

  return { downloadId, version: latestFile.version };
}

async function downloadAndInstall(api: types.IExtensionApi, gameId: string, nexusModId: number) {
  const { downloadId } = await download(api, gameId, nexusModId);

  // install the tool
  const modId = await util.toPromise(cb => api.events.emit('start-install-download', downloadId, false, cb));

  // enable it
  const profileId = selectors.lastActiveProfileForGame(api.getState(), gameId);
  api.store.dispatch(actions.setModEnabled(profileId, modId, true));

  return modId;
}

export function updateSMPCTool(api: types.IExtensionApi,
                               gameId: string,
                               execPath: string) {
  api.store.dispatch(actions.addDiscoveredTool(gameId, TOOL_ID, {
    ...SMPCTool,
    path: execPath,
    hidden: false,
    custom: false,
    defaultPrimary: false,
    workingDirectory: path.dirname(execPath),
  }, true));
}

export function makeTestMerge(api: types.IExtensionApi, gameId: string): types.MergeTest {
  return (game) => {
    if (game.id !== gameId) {
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
export function makeMerge(api: types.IExtensionApi, gameId: string): types.MergeFunc {
  return async (filePath, mergePath) => {
    // creates a new archive from the loose files in the mod directories

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

    const fileExt = gameId === GAME_ID ? MOD_EXT : MM_MOD_EXT;
    const szip = new util.SevenZip();
    const archivePath = path.join(mergePath, `VortexMergedMod${fileExt}`);
    const arcExists = await fs.statAsync(archivePath).then(() => true, () => false);
    if (!arcExists) {
      const infoPath = path.join(mergePath, SMPC_INFO);
      await fs.writeFileAsync(infoPath, modInfo, { encoding: 'utf8' });
      await szip.add(archivePath, [ infoPath ], { raw: ['-r', '-tzip'] });
      await fs.removeAsync(infoPath);
      const game = util.getGame(gameId);
      if (game?.extensionPath) {
        const vortexThumb = path.join(game.extensionPath, 'Thumbnail.png');
        await szip.add(archivePath, [ vortexThumb ], { raw: ['-r', '-tzip'] });
      }
    }
    await szip.add(archivePath, [ modFiles ], { raw: ['-r', '-tzip'] });
  }
}

export async function runSMPCTool(api: types.IExtensionApi,
                                  toolPath: string) {
  try {
    await fs.statAsync(toolPath);

  } catch (err) {
    return err.code === 'ENOENT' ? Promise.resolve() : Promise.reject(err);
  }

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

export async function runSuitTool(api: types.IExtensionApi,
                                  gameId: string,
                                  toolPath: string,
                                  deployment: { [typeId: string]: types.IDeployedFile[] }) {
  const suitFiles: types.IDeployedFile[] = deployment[''].filter(file => path.extname(file.relPath) === '.suit');

  if (suitFiles.length === 0) {
    // do nothing if no suit mods installed
    return;
  }

  const discovery = selectors.discoveryByGame(api.getState(), gameId);

  try {
    const toolExePath = path.join(toolPath, SUIT_TOOL_EXEC);
    await fs.statAsync(toolExePath);

    const game: types.IGame = util.getGame(gameId);

    const modPaths = game.getModPaths(discovery.path);

    for (const suitFile of suitFiles) {
      const suitPath = path.join(modPaths[''], suitFile.relPath);
      log('info', 'processing suit file', suitPath);
      let stdout = '';
      let stderr = '';

      try {
        const cp = await import('child_process');

        await new Promise((resolve, reject) => {
          const proc = cp.spawn(toolExePath, [suitPath], { cwd: toolPath });
          proc.stdout.on('data', chunk => stdout += chunk.toString('utf8'));
          proc.stderr.on('data', chunk => stderr += chunk.toString('utf8'));
          proc
            .on('exit', code => resolve(code))
            .on('error', () => reject(new Error(stderr)));
        });
      } catch (err) {
        // This is quite hacky since the tool inevitably fails at the end because it tries to read key
        // input from the console in a way that isn't compatible with redirected input so this is trying
        // to figure out if anything actually went wrong

        // yes, there's a typo, that's in the tool. adding the alternative just in case the author fixes
        // the typo without changing the phrasing
        if (stdout.includes('Suit Added Succesfully')
            || stdout.includes('Suit Added Successfully')) {
          continue;
        }

        log('warn', 'suit adder tool failed', { stdout, stderr });
        if (stdout.includes('Sequence contains no elements')) {
          api.showErrorNotification(
            'Failed to run "Suit Adder Tool"',
            'Error was "Sequence contains no elements".\n'
            + 'Suggested solutions from the tool author:\n'
            + ' - "One of the smpcmods you have installed is incompatible with the tool you need to uninstall it."\n'
            + ' - "Try verifying game files and installing again"', {
            allowReport: false,
          });
        } else if (stdout.includes('Offset outside limit')) {
          api.showErrorNotification(
            'Failed to run "Suit Adder Tool"',
            'Error was "Offset outside limit".\n'
            + 'Suggested solutions from the tool author:\n'
            + ' - "Delete toc.BAK and verify your game files."', {
              allowReport: false,
            });
        } else if (stdout.includes('cannot be read past the end of the stream')) {
          api.showErrorNotification(
            'Failed to run "Suit Adder Tool"',
            'Error was "cannot be read past the end of the stream".\n'
            + 'This probably means one of the suits is not compatible with the tool. Check everything for updates.', {
              allowReport: false,
            });
        } else {
          api.showErrorNotification(
            'Failed to run "Suit Adder Tool"',
            'Please check the log for full error message. Common solutions are:\n'
            + ' - validate game files\n'
            + ' - delete toc.BAK\n'
            + ' - check tool and suit files for updates', {
              allowReport: false,
            });
        }
      }
    }
  } catch (err) {
    // tool not installed but there are mods that would require it so inform the user
    if (err.code === 'ENOENT') {
      api.sendNotification({
        type: 'warning',
        message: 'You have mods installed that require the "Suit Adder Tool" to activate. '
              + 'Vortex can run this automatically if you let it install the tool for you.',
        allowSuppress: true,
        actions: [
          { title: 'Install', action: dismiss => {
            dismiss();
            (async () => {
              try {
                await ensureSuitTool(api, gameId, discovery);
              } catch (err) {
                api.showErrorNotification('Failed to install "Suit Adder Tool"', err);
              }
            })();
          } }
        ]
      })
    } else {
      return Promise.reject(err);
    }
  }
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