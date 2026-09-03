import { loadSetupValues } from '@/lib/setup/actions';
import { setupState } from '@/lib/setup/state';
import { SetupWizard } from './setup-wizard';
import { PAGE_NARROW } from '@/lib/layout';

/** Shared by /setup and by the root layout's first-run gate, so both show the
 * same thing without the wizard being built twice. */
export async function SetupGate() {
  const { values, masked } = await loadSetupValues();
  return (
    <div className={`${PAGE_NARROW} mx-auto px-6 py-12`}>
      <SetupWizard values={values} masked={masked} state={setupState()} />
    </div>
  );
}
