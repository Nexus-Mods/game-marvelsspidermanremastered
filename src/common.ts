import path from 'path';

export const GAME_ID = 'marvelsspidermanremastered';
export const TOOL_ID = 'SMPCModdingTool';
export const TOOL_EXEC = 'SMPCTool.exe';
export const SMPC_INFO = 'SMPCMod.info';
export const MOD_EXT = '.smpcmod';
export const LO_FILE = 'ModManager.txt'
export const SMPCTool = {
  id: TOOL_ID,
  name: 'SMPC Modding Tool',
  logo: 'app.ico',
  executable: () => TOOL_EXEC,
  requiredFiles: [
    TOOL_EXEC,
  ],
};

export function getSMPCModPath() {
  return path.join('SMPCTool', 'ModManager', 'SMPCMods');
}

export function getLOFilePath() {
  return path.join('SMPCTool', 'ModManager', LO_FILE);
}