import path from 'path';

// Shared
export const TOOL_ID = 'SMPCModdingTool';
export const SUIT_TOOL_ID = 'SuitAdderTool';
export const SMPC_INFO = 'SMPCMod.info';
export const LO_FILE = 'ModManager.txt'

export const MOD_TYPE_ID = 'smpc-mod';
export const TOOL_TYPE_ID = 'smpc-modding-tool';
export const SUIT_TOOL_EXEC = 'Suit Adder Tool.exe';

// Spider-Man
export const GAME_ID = 'marvelsspidermanremastered';
export const TOOL_EXEC = 'SMPCTool.exe';
export const TOOL_PAGE_ID = 51;
export const SUIT_TOOL_PAGE_ID = 2318;
export const MOD_EXT = '.smpcmod';
export const MODPACK_EXT = '.smpcmodpack';
export const SMPCTool = {
  id: TOOL_ID,
  name: 'SMPC Modding Tool',
  logo: 'app.ico',
  executable: () => TOOL_EXEC,
  requiredFiles: [
    TOOL_EXEC,
  ],
};

// Miles Morales
export const MM_GAME_ID = 'spidermanmilesmorales';
export const MM_TOOL_EXEC = 'MMPCTool.exe';
export const MM_TOOL_PAGE_ID = 8;
export const MM_SUIT_TOOL_PAGE_ID = 2;
export const MM_MOD_EXT = '.mmpcmod';
export const MM_MODPACK_EXT = '.mmpcmodpack';
export const MM_PCTool = {
  id: TOOL_ID,
  name: 'SMPC Modding Tool',
  logo: 'app.ico',
  executable: () => MM_TOOL_EXEC,
  requiredFiles: [
    MM_TOOL_EXEC,
  ],
};

export function getSMPCModPath(gameId) {
  return path.join('SMPCTool', 'ModManager', gameId === GAME_ID ? 'SMPCMods' : 'MMPCMods');
}

export function getLOFilePath() {
  return path.join('SMPCTool', 'ModManager', LO_FILE);
}