import { describe, expect, it } from 'vitest';

import {
  kimiCodeFeedbackUploadCompleteUrl,
  kimiCodeFeedbackUploadUrl,
} from '../src/managed-feedback-upload';

describe('oauth/managed-feedback-upload — URL builders', () => {
  it('kimiCodeFeedbackUploadUrl returns a /feedback/upload_url URL', () => {
    const url = new URL(kimiCodeFeedbackUploadUrl());
    expect(url.protocol).toBe('https:');
    expect(url.pathname).toMatch(/\/feedback\/upload_url\/?$/);
  });

  it('kimiCodeFeedbackUploadCompleteUrl returns a /feedback/upload_complete URL', () => {
    const url = new URL(kimiCodeFeedbackUploadCompleteUrl());
    expect(url.protocol).toBe('https:');
    expect(url.pathname).toMatch(/\/feedback\/upload_complete\/?$/);
  });

  it('kimiCodeFeedbackUploadCompleteUrl shares the host with the upload URL', () => {
    const upload = new URL(kimiCodeFeedbackUploadUrl());
    const complete = new URL(kimiCodeFeedbackUploadCompleteUrl());
    expect(complete.host).toBe(upload.host);
  });

  it('honors a custom https base URL on the upload endpoint', () => {
    const url = new URL(kimiCodeFeedbackUploadUrl('https://example.test/api/v1/'));
    expect(url.origin).toBe('https://example.test');
    expect(url.pathname).toMatch(/\/feedback\/upload_url\/?$/);
  });

  it('honors a custom https base URL on the complete endpoint', () => {
    const url = new URL(kimiCodeFeedbackUploadCompleteUrl('https://example.test/api/v1/'));
    expect(url.origin).toBe('https://example.test');
    expect(url.pathname).toMatch(/\/feedback\/upload_complete\/?$/);
  });
});
