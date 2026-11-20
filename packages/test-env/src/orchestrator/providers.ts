import { UnknownServiceError } from "./errors.js";
import type { ServiceProvider } from "./types.js";

export class ServiceProviderRegistry {
  private readonly providers = new Map<string, ServiceProvider>();

  register(provider: ServiceProvider): void {
    this.providers.set(provider.serviceName, provider);
  }

  get(name: string): ServiceProvider | undefined {
    return this.providers.get(name);
  }

  require(name: string): ServiceProvider {
    const provider = this.providers.get(name);
    if (!provider) {
      throw new UnknownServiceError(name);
    }
    return provider;
  }

  list(): readonly ServiceProvider[] {
    return [...this.providers.values()];
  }
}
