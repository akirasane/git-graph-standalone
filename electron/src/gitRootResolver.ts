import { exec } from 'child_process';
import { getPathFromStr } from './utils';

/**
 * The minimal slice of dataSource.ts's API that RepoManager depends on. Phase 3 ports the real
 * DataSource class (git command wrapper); it will structurally satisfy this interface, so
 * RepoManager needs no changes when that happens.
 */
export interface RepoDataSource {
	repoRoot(pathOfPotentialRepo: string): Promise<string | null>;
	getSubmodules(repo: string): Promise<string[]>;
}

/**
 * Temporary stand-in for Phase 3's real DataSource, just enough to let RepoManager's fs-walk
 * discovery be exercised/verified now. `repoRoot` mirrors dataSource.ts's core logic (`git
 * rev-parse --show-toplevel`) without its Windows UNC/mapped-drive path fixup - that edge case
 * belongs in the real Phase 3 port, not this placeholder.
 */
export class SimpleGitRootResolver implements RepoDataSource {
	public repoRoot(pathOfPotentialRepo: string): Promise<string | null> {
		return new Promise((resolve) => {
			exec('git rev-parse --show-toplevel', { cwd: pathOfPotentialRepo }, (err, stdout) => {
				resolve(err ? null : getPathFromStr(stdout.trim()));
			});
		});
	}

	public getSubmodules(_repo: string): Promise<string[]> {
		return Promise.resolve([]);
	}
}
