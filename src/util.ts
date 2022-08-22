import { selectors, types, util } from 'vortex-api';

import { GAME_ID } from './common';

export function isModEnabled(api: types.IExtensionApi, modId: string) {
  const state = api.getState();
  const profileId = selectors.lastActiveProfileForGame(state, GAME_ID);
  const profile = selectors.profileById(state, profileId);
  return util.getSafe(profile, ['modState', modId, 'enabled'], false);
}