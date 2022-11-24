import { selectors, types, util } from 'vortex-api';

import { GAME_ID, MM_GAME_ID } from './common';

export function isSpiderManGame(gameId: string) {
  return [GAME_ID, MM_GAME_ID].includes(gameId);
}

export function isModEnabled(api: types.IExtensionApi, gameId: string, modId: string) {
  const state = api.getState();
  const profileId = selectors.lastActiveProfileForGame(state, gameId);
  const profile = selectors.profileById(state, profileId);
  return util.getSafe(profile, ['modState', modId, 'enabled'], false);
}