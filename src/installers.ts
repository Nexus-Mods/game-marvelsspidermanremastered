import path from 'path';
import { types, selectors } from 'vortex-api';
import { GAME_ID, getSMPCModPath, MM_MODPACK_EXT, MM_MOD_EXT, MM_TOOL_EXEC, MODPACK_EXT, MOD_EXT, MOD_TYPE_ID, TOOL_EXEC } from './common';
import { updateSMPCTool } from './toolIntegration';
import { isSpiderManGame } from './util';

export async function testSMPCTool(files: string[], gameId: string): Promise<types.ISupportedResult> {
  const exec = gameId === GAME_ID ? TOOL_EXEC : MM_TOOL_EXEC;
  return Promise.resolve({
    requiredFiles: [],
    supported: isSpiderManGame(gameId) && files.includes(exec),
  });
}

export function installSMPCTool(api: types.IExtensionApi,
                                files: string[],
                                destinationPath: string,
                                gameId: string): Promise<types.IInstallResult> {
  const filtered = files.filter(file => !!path.extname(file));
  const installDir = selectors.installPathForGame(api.getState(), gameId);
  const expectedDestination = path.join(installDir, path.basename(destinationPath, '.installing'));
  const fileInstructions: types.IInstruction[] = filtered.map(file => ({
    type: 'copy',
    source: file,
    destination: file,
  }));

  const discovery: types.IDiscoveryResult = selectors.discoveryByGame(api.getState(), gameId);
  const assetArchivePath = path.join(discovery.path, 'asset_archive') + path.sep;
  const genInstructions: types.IInstruction = {
    type: 'generatefile',
    data: Buffer.from(assetArchivePath),
    destination: 'assetArchiveDir.txt',
  }

  const modTypeInstruction: types.IInstruction = {
    type: 'setmodtype',
    value: 'smpc-modding-tool',
  };

  const instructions: types.IInstruction[] = fileInstructions.concat(modTypeInstruction, genInstructions);
  updateSMPCTool(api, gameId, expectedDestination);
  return Promise.resolve({ instructions });
}

export async function testSMPCModpack(files: string[], gameId: string): Promise<types.ISupportedResult> {
  const fileExt = gameId === GAME_ID ? MODPACK_EXT : MM_MODPACK_EXT;

  return Promise.resolve({
    requiredFiles: [],
    supported: isSpiderManGame(gameId)
      && files.find(file => path.extname(file) === fileExt) !== undefined,
  });
}

export async function installSMPCModpack(api: types.IExtensionApi,
                                         files: string[],
                                         destinationPath: string,
                                         gameId: string)
                                         : Promise<types.IInstallResult> {
  const fileExt = gameId === GAME_ID ? MODPACK_EXT : MM_MODPACK_EXT;
  const modpack = files.find(file => path.extname(file) === fileExt);
  const filePath = path.join(destinationPath, modpack);
  return {
    instructions: [
      { type: 'submodule', key: modpack, path: filePath },
    ]
  };
}

export async function testSMPCMod(files: string[], gameId: string): Promise<types.ISupportedResult> {
  const fileExt = gameId === GAME_ID ? MOD_EXT : MM_MOD_EXT;

  return Promise.resolve({
    requiredFiles: [],
    supported: isSpiderManGame(gameId)
      && files.find(file => path.extname(file) === fileExt) !== undefined,
  });
}

export async function chooseSMPCMod(api: types.IExtensionApi, files: string[]): Promise<string[]> {
  const toId = filePath => path.basename(filePath, path.extname(filePath));
  const result: types.IDialogResult = await api.showDialog('question', 'Select SMPC Mod', {
    bbcode: 'The archive you are installing contains multiple mod files.[br][/br][br][/br]'
          + 'There are multiple potential reasons for this, they may all be required, may be variants for you to pick one '
          + 'or one might be an uninstaller. If in doubt, please consult the mod description.',
    checkboxes: files.map((file, idx) => ({
      id: toId(file),
      text: file,
      value: idx === 0,
    })),
  }, [
    { label: 'Select' }
  ]);
  return files.filter(filePath => result.input[toId(filePath)]);
}

export async function installSMPCMod(api: types.IExtensionApi,
                                     files: string[],
                                     destinationPath: string,
                                     gameId: string)
                                     : Promise<types.IInstallResult> {
  const fileExt = gameId === GAME_ID ? MOD_EXT : MM_MOD_EXT;

  let { modFiles, assets } = files.reduce<{ modFiles: string[], assets: string[] }>((prev, file) => {
    if (file.endsWith(path.sep)) {
      // ignore directories
    } else if (path.extname(file) === fileExt) {
      prev.modFiles.push(file);
    } else {
      prev.assets.push(file);
    }
    return prev;
  }, { modFiles: [], assets: [] });

  if (modFiles.length > 1) {
    modFiles = await chooseSMPCMod(api, modFiles);
  }

  const instructions: types.IInstruction[] = [].concat(modFiles
    .map(file => ({
      type: 'copy',
      source: file,
      destination: path.join(getSMPCModPath(gameId), path.basename(file)),
    }))
    , assets.map(file => ({
      type: 'copy',
      source: file,
      destination: file,
    })));

  return {
    instructions,
  };

  /* Previously this installer would unpack .smpcmod files and then the merger recombines
     all mods installed through Vortex in a single .smpcmod archive. The only effect
     this has is that load ordering for these mods becomes incompatible.
     Still, the following is that process, simplified from 1.0.2 and extended to support
     Miles Morales, keeping it in case there was a point to it after all.

  const fileExt = gameId === GAME_ID ? MOD_EXT : MM_MOD_EXT;

  const filtered = files.filter(file => path.extname(file) === fileExt);
  const seven = new util.SevenZip();
  const fileMap: { [id: string]: IEntry[] } = {};

  // if the mod contains multiple archives (files with MOD_EXT extension), and multiple of
  // them contain the same files, we force the user to pick one archive and then install
  // only that.
  let selectedIds: string[];

  const instructionsMap: { [id: string]: types.IInstruction[] } = {};
  const mergedInstructions = () => [].concat(...Object.values(instructionsMap));

  // this extracts all included archives and sets up a map of archives and their respective file lists
  for (const file of filtered) {
    const id = path.basename(file, path.extname(file));
    const tempPath = path.join(destinationPath, id);
    await fs.ensureDirWritableAsync(tempPath);
    await seven.extractFull(path.join(destinationPath, file), tempPath);
    let modEntries: IEntry[] = [];
    await turbowalk(tempPath, (entries) => {
      modEntries = modEntries.concat(entries);
    });
    fileMap[id] = [].concat(fileMap[id] ?? [], modEntries);
  }

  // iterate those file lists
  for (const [id, entries] of Object.entries(fileMap)) {
    if ((selectedIds !== undefined) && (!selectedIds.includes(id))) {
      continue;
    }
    const tempPath = path.join(destinationPath, id);

    const instructions: types.IInstruction[] = [];

    for (const entry of entries) {
      if (!entry.isDirectory) {
        const destination = path.relative(tempPath, entry.filePath);
        // if the user hasn't chosen yet and any of the instructions already tries to install this file
        if ((selectedIds === undefined)
            && mergedInstructions().find(instr => instr.destination === destination) !== undefined) {
          // ask the user which archive to install
          selectedIds = await chooseSMPCMod(api, filtered);
          if (!selectedIds.includes(id)) {
            continue;
          }
        }
        instructions.push({
          type: 'copy',
          source: path.relative(destinationPath, entry.filePath),
          destination,
        });
      }
    }

    instructionsMap[id] = [].concat(instructions);
  }

  // if there was a collision between any two archives, install only the one the user picked.
  // if there was none, install them all?
  const fileInstructions = (selectedIds !== undefined)
    ? [].concat(...(Object.keys(instructionsMap).filter(id => selectedIds.includes(id)).map(id => instructionsMap[id])))
    : mergedInstructions();

  const modTypeInstruction: types.IInstruction = {
    type: 'setmodtype',
    value: MOD_TYPE_ID,
  };

  const instructions: types.IInstruction[] = fileInstructions.concat(modTypeInstruction);
  return Promise.resolve({ instructions });
  */
}