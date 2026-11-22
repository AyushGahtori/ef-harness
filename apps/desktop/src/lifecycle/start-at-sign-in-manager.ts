import { HIDDEN_TRAY_ARG } from "./types.js";

export const START_AT_SIGN_IN_LABEL = "Start EF Harness when Windows signs in";

export interface LoginItemSettingsHost {
  setLoginItemSettings(settings: { openAtLogin: boolean; args: string[] }): void;
  getLoginItemSettings(): { openAtLogin: boolean; args?: string[] };
}

export class StartAtSignInManager {
  private enabled: boolean;

  constructor(private readonly app: LoginItemSettingsHost) {
    this.enabled = app.getLoginItemSettings().openAtLogin === true;
  }

  get label(): string {
    return START_AT_SIGN_IN_LABEL;
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  setEnabled(openAtLogin: boolean): void {
    this.enabled = openAtLogin;
    this.app.setLoginItemSettings({
      openAtLogin,
      args: [HIDDEN_TRAY_ARG],
    });
  }
}
