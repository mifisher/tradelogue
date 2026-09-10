import { loadSetupValues } from '@/lib/setup/actions';
import { setupState } from '@/lib/setup/state';
import { SetupWizard } from './setup-wizard';
import { PageShell } from '@/components/page-shell';

/** Shared by /setup and by the root layout's first-run gate, so both show the
 * same thing without the wizard being built twice. */
export async function SetupGate() {
  const { values, masked } = await loadSetupValues();
  return (
    <PageShell>
      <SetupWizard values={values} masked={masked} state={setupState()} />
    </PageShell>
  );
}
