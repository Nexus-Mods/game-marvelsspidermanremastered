import path from 'path';
import { types, selectors, util, fs } from 'vortex-api';
import { GAME_ID, MOD_EXT, TOOL_EXEC } from './common';
import { updateSMPCTool } from './smpcIntegration';
import turbowalk, { IEntry } from 'turbowalk';

const FILE_EXT = '.smpcmod';

export async function testSMPCTool(files: string[], gameId: string): Promise<types.ISupportedResult> {
  return Promise.resolve({
    requiredFiles: [],
    supported: gameId === GAME_ID && files.includes(TOOL_EXEC),
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
  updateSMPCTool(api, expectedDestination);
  return Promise.resolve({ instructions });
}

export async function testSMPCMod(files: string[], gameId: string): Promise<types.ISupportedResult> {
  return Promise.resolve({
    requiredFiles: [],
    supported: gameId === GAME_ID
      && files.find(file => path.extname(file) === FILE_EXT) !== undefined,
  });
}

export async function chooseSMPCMod(api: types.IExtensionApi, files: string[]) {
  const t = api.translate;
  const result: types.IDialogResult = await api.showDialog('question', 'Select SMPC Mod', {
    bbcode: t('The mod you are installing appears to provide variants of the same asset files (or potentially both an installer and uninstaller).[br][/br][br][/br]'
            + 'Vortex cannot install multiple variants of the same asset file. Please select the mod you want to install.'),
    choices: files.map((file, idx) => ({
      id: path.basename(file, MOD_EXT),
      text: file,
      value: idx === 0,
    })),
  }, [
    { label: 'Select' }
  ]);
  return Object.keys(result.input).find(choice => result.input[choice]);
}

export async function installSMPCMod(api: types.IExtensionApi,
                                     files: string[],
                                     destinationPath: string)
                                     : Promise<types.IInstallResult> {
  const filtered = files.filter(file => path.extname(file) === FILE_EXT);
  const seven = new util.SevenZip();
  const fileMap: { [id: string]: IEntry[] } = {};
  let preferredId: string;

  const instructionsMap: { [id: string]: types.IInstruction[] } = {};
  const mergedInstructions = () => Object.keys(instructionsMap).reduce((accum, id) => [].concat(accum, instructionsMap[id]), []);
  for (const file of filtered) {
    const id = path.basename(file, path.extname(file));
    const tempPath = path.join(destinationPath, id);
    await fs.ensureDirWritableAsync(tempPath);
    await seven.extractFull(path.join(destinationPath, file), tempPath);
    let modEntries: IEntry[] = [];
    await new Promise<void>((resolve, reject) => {
      return turbowalk(tempPath, (entries) => {
        modEntries = modEntries.concat(entries);
      }).then(resolve);
    });
    fileMap[id] = [].concat(fileMap[id] ?? [], modEntries);
  }

  for (const [id, entries] of Object.entries(fileMap)) {
    if (preferredId !== undefined && preferredId !== id) {
      continue;
    }
    const tempPath = path.join(destinationPath, id);
    const instr = await (entries.reduce(async (accumP, entry) => {
      const accum = await accumP;
      if (entry.isDirectory) {
        return Promise.resolve(accum);
      }
      const destination = path.relative(tempPath, entry.filePath);
      if (!preferredId && mergedInstructions().find(instr => instr.destination === destination) !== undefined) {
        preferredId = await chooseSMPCMod(api, filtered);
        if (id !== preferredId) {
          return Promise.resolve(accum);
        }
      }
      const data = await fs.readFileAsync(entry.filePath);
      accum.push({
        type: 'generatefile',
        data,
        destination,
      });
      return Promise.resolve(accum);
    }, Promise.resolve([])));

    instructionsMap[id] = [].concat(instr);
  }

  const fileInstructions = preferredId !== undefined
    ? instructionsMap[preferredId]
    : mergedInstructions();

  const modTypeInstruction: types.IInstruction = {
    type: 'setmodtype',
    value: 'smpc-mod',
  };

  const instructions: types.IInstruction[] = fileInstructions.concat(modTypeInstruction);
  return Promise.resolve({ instructions });
}