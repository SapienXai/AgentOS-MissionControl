export type SnapshotLoadProfile = "interactive" | "refresh";

export type SnapshotPair<TSnapshot> = {
  visible: TSnapshot;
  full: TSnapshot;
};

type SnapshotCacheEntry<TSnapshot> = SnapshotPair<TSnapshot> & {
  expiresAt: number;
};

export class SnapshotCacheController<TSnapshot> {
  private cache: SnapshotCacheEntry<TSnapshot> | null = null;
  private promise: Promise<SnapshotPair<TSnapshot>> | null = null;
  private generation = 0;

  constructor(
    private readonly options: {
      ttlMs: number;
      load: (profile: SnapshotLoadProfile, generation: number) => Promise<SnapshotPair<TSnapshot>>;
    }
  ) {}

  getGeneration() {
    return this.generation;
  }

  clear(options: { incrementGeneration?: boolean } = {}) {
    if (options.incrementGeneration) {
      this.generation += 1;
    }

    this.cache = null;
  }

  async get(options: { force?: boolean; includeHidden?: boolean } = {}) {
    const cachedSnapshot = this.cache;
    const cacheIsFresh = Boolean(cachedSnapshot && cachedSnapshot.expiresAt > Date.now());

    if (!options.force && cacheIsFresh && cachedSnapshot) {
      return selectSnapshot(cachedSnapshot, options.includeHidden);
    }

    if (!options.force && cachedSnapshot) {
      if (!this.promise) {
        this.promise = this.loadForCurrentGeneration("interactive");
        void this.promise.catch(() => {});
        void this.promise.finally(() => {
          this.promise = null;
        }).catch(() => {});
      }

      return selectSnapshot(cachedSnapshot, options.includeHidden);
    }

    if (options.force) {
      this.generation += 1;
      this.cache = null;
      this.promise = this.loadForCurrentGeneration("refresh");
      void this.promise.catch(() => {});

      try {
        const nextSnapshot = await this.promise;
        return selectSnapshot(nextSnapshot, options.includeHidden);
      } finally {
        this.promise = null;
      }
    }

    if (this.promise) {
      const pending = await this.promise;
      return selectSnapshot(pending, options.includeHidden);
    }

    this.promise = this.loadForCurrentGeneration("interactive");
    void this.promise.catch(() => {});

    try {
      const nextSnapshot = await this.promise;
      return selectSnapshot(nextSnapshot, options.includeHidden);
    } finally {
      this.promise = null;
    }
  }

  private loadForCurrentGeneration(profile: SnapshotLoadProfile) {
    const generation = this.generation;

    return this.options.load(profile, generation).then((nextSnapshot) => {
      if (generation === this.generation) {
        this.cache = {
          ...nextSnapshot,
          expiresAt: Date.now() + this.options.ttlMs
        };
      }

      return nextSnapshot;
    });
  }
}

function selectSnapshot<TSnapshot>(
  snapshot: SnapshotPair<TSnapshot>,
  includeHidden?: boolean
) {
  return includeHidden ? snapshot.full : snapshot.visible;
}
