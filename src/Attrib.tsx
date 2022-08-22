import * as React from 'react';
import { useTranslation } from 'react-i18next';
import { Dashlet } from 'vortex-api';

const contributors = [
  'Tkachov',
];

export default function SMPCAttribDashlet() {
  const [t] = useTranslation();
  return (
    <Dashlet
      title={t('Support for this game is made possible using the Spider-Man PC Modding Tool')}
      className='dashlet-smpc'
    >
      <div>
        {t('Special thanks to {{author}} for developing this tool, and all its contributors: {{nl}}"{{contributors}}"',
          { replace: { author: 'Josh | jedijosh920', nl: '\n', contributors: contributors.length > 1 ? contributors.join(', ') : contributors[0] } })}
      </div>
    </Dashlet>
  );
}
