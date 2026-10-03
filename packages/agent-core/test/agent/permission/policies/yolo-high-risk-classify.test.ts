import { describe, expect, it } from 'vitest';

import { classifyYoloHighRiskBash } from '#/agent/permission/policies/yolo-high-risk-ask';

describe('classifyYoloHighRiskBash — non-risky', () => {
  it('returns undefined on empty input', () => {
    expect(classifyYoloHighRiskBash('')).toBeUndefined();
    expect(classifyYoloHighRiskBash('   \n  ')).toBeUndefined();
  });

  it('returns undefined for safe commands', () => {
    expect(classifyYoloHighRiskBash('ls -la')).toBeUndefined();
    expect(classifyYoloHighRiskBash('echo hello world')).toBeUndefined();
    expect(classifyYoloHighRiskBash('git status')).toBeUndefined();
    expect(classifyYoloHighRiskBash('pnpm test')).toBeUndefined();
  });
});

describe('classifyYoloHighRiskBash — destructive', () => {
  it('flags recursive force delete (rm -rf)', () => {
    expect(classifyYoloHighRiskBash('rm -rf /tmp/build')).toBe('recursive force delete');
  });

  it('flags rm -f', () => {
    expect(classifyYoloHighRiskBash('rm -f some-file.txt')).toBe('force delete');
  });

  it('flags native Windows forced and recursive deletion', () => {
    expect(classifyYoloHighRiskBash('Remove-Item C:\\\\output -Recurse -Force')).toBe('recursive or forced remove');
    expect(classifyYoloHighRiskBash('Remove-Item C:\\output -Recurse')).toBe('recursive or forced remove');
    expect(classifyYoloHighRiskBash('Remove-Item -Force C:\\output')).toBe('recursive or forced remove');
    expect(classifyYoloHighRiskBash('rmdir /s /q C:\\\\output')).toBe('Windows recursive or quiet delete');
  });

  it('flags disk partition and destructive database commands', () => {
    expect(classifyYoloHighRiskBash('diskutil eraseDisk APFS data disk3')).toBe('disk erase or partition command');
    expect(classifyYoloHighRiskBash('psql -c "DROP DATABASE app"')).toBe('destructive database command');
    expect(classifyYoloHighRiskBash('psql -c "TRUNCATE TABLE events"')).toBe('destructive database command');
  });

  it('flags mkfs', () => {
    expect(classifyYoloHighRiskBash('mkfs.ext4 /dev/sda1')).toBe('filesystem formatting command');
  });

  it('flags dd if=… of=/dev/…', () => {
    expect(classifyYoloHighRiskBash('dd if=/dev/zero of=/dev/sda bs=1M')).toBe('raw disk write');
  });

  it('flags git reset --hard', () => {
    expect(classifyYoloHighRiskBash('git reset --hard HEAD~3')).toBe('hard git reset');
  });

  it('flags git clean -fd', () => {
    expect(classifyYoloHighRiskBash('git clean -fd')).toBe('git clean can remove untracked files');
  });

  it('flags terraform destroy', () => {
    expect(classifyYoloHighRiskBash('terraform destroy -auto-approve')).toBe('Terraform destroy');
  });

  it('flags kubectl delete', () => {
    expect(classifyYoloHighRiskBash('kubectl delete ns foo')).toBe('Kubernetes delete');
  });

  it('flags docker system prune', () => {
    expect(classifyYoloHighRiskBash('docker system prune -a')).toBe('Docker prune');
  });
});

describe('classifyYoloHighRiskBash — credential-like', () => {
  it('flags password assignment', () => {
    expect(classifyYoloHighRiskBash('export PASSWORD=hunter2')).toBe('credential-like assignment');
  });

  it('flags api_key assignment', () => {
    expect(classifyYoloHighRiskBash('FOO=bar API_KEY=xxx')).toBe('credential-like assignment');
  });

  it('flags sk-… OpenAI-shaped token', () => {
    expect(classifyYoloHighRiskBash('echo sk-abcdefghijklmnopqrstuvwxyz0123456789')).toBe(
      'token-like secret',
    );
  });

  it('flags private key header', () => {
    expect(classifyYoloHighRiskBash('cat -----BEGIN RSA PRIVATE KEY----- file')).toBe(
      'private key material',
    );
  });

  it('flags .env path', () => {
    expect(classifyYoloHighRiskBash('cat /home/me/.env')).toBe('dotenv access');
  });

  it('flags .aws/credentials', () => {
    expect(classifyYoloHighRiskBash('cat ~/.aws/credentials')).toBe('aws credentials access');
  });

  it('flags .ssh path', () => {
    expect(classifyYoloHighRiskBash('ls /home/me/.ssh/')).toBe('ssh key material access');
  });
});
