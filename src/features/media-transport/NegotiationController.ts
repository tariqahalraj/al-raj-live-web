export class NegotiationController {
  private inFlightNegotiation: boolean = false;
  private queue: Array<() => Promise<void>> = [];
  private currentGeneration: number = 1;

  setGeneration(generation: number) {
    this.currentGeneration = generation;
  }

  getGeneration(): number {
    return this.currentGeneration;
  }

  /**
   * Enqueue a serialized negotiation operation
   */
  async enqueueNegotiation<T>(
    generation: number,
    operation: () => Promise<T>
  ): Promise<T> {
    if (generation < this.currentGeneration) {
      throw new Error(`[NegotiationController] Stale generation ${generation} < current ${this.currentGeneration}`);
    }

    return new Promise<T>((resolve, reject) => {
      const task = async () => {
        if (generation < this.currentGeneration) {
          reject(new Error(`[NegotiationController] Operation dropped due to newer generation ${this.currentGeneration}`));
          return;
        }

        try {
          const result = await operation();
          resolve(result);
        } catch (err) {
          reject(err);
        }
      };

      this.queue.push(task);
      this.processQueue();
    });
  }

  private async processQueue() {
    if (this.inFlightNegotiation || this.queue.length === 0) {
      return;
    }

    this.inFlightNegotiation = true;
    const nextTask = this.queue.shift();

    if (nextTask) {
      try {
        await nextTask();
      } catch (err) {
        console.error('[NegotiationController] Task error:', err);
      } finally {
        this.inFlightNegotiation = false;
        this.processQueue();
      }
    } else {
      this.inFlightNegotiation = false;
    }
  }

  reset() {
    this.inFlightNegotiation = false;
    this.queue = [];
  }

  /**
   * Bounded ICE gathering: finishes as soon as candidates are gathered or bounded timeout (500-600 ms)
   * Drastically reduces initial sound latency while ensuring candidate presence
   */
  async gatherIce(pc: RTCPeerConnection, timeoutMs: number = 600): Promise<void> {
    if (pc.iceGatheringState === 'complete') {
      return;
    }

    return new Promise<void>((resolve) => {
      let resolved = false;
      let candidateDebounce: number | null = null;

      const finish = () => {
        if (!resolved) {
          resolved = true;
          pc.removeEventListener('icegatheringstatechange', checkState);
          pc.removeEventListener('icecandidate', checkCandidate);
          clearTimeout(maxTimer);
          if (candidateDebounce) clearTimeout(candidateDebounce);
          resolve();
        }
      };

      const checkState = () => {
        if (pc.iceGatheringState === 'complete') {
          finish();
        }
      };

      const checkCandidate = (event: RTCPeerConnectionIceEvent) => {
        if (event.candidate && !candidateDebounce) {
          // Once the first candidate is received, allow a fast 120ms window for other local candidates
          candidateDebounce = window.setTimeout(finish, 120);
        }
      };

      const maxTimer = setTimeout(finish, timeoutMs);

      pc.addEventListener('icegatheringstatechange', checkState);
      pc.addEventListener('icecandidate', checkCandidate);
    });
  }

  /**
   * Inspect SDP to extract the mid attribute for audio
   */
  extractAudioMid(sdp: string): string {
    const lines = sdp.split('\r\n');
    let inAudioSection = false;

    for (const line of lines) {
      if (line.startsWith('m=audio')) {
        inAudioSection = true;
        continue;
      }
      if (line.startsWith('m=video') || line.startsWith('m=application')) {
        inAudioSection = false;
        continue;
      }
      if (inAudioSection && line.startsWith('a=mid:')) {
        return line.replace('a=mid:', '').trim();
      }
    }

    // Fallback if not found
    return '0';
  }

  /**
   * Munges Opus SDP parameters to optimize for standard (24 kbps) or low-data saver (12 kbps Opus DTX)
   */
  mungeOpusSdp(sdp: string, mode: 'standard' | 'low-data'): string {
    const lines = sdp.split('\r\n');
    let opusPt: string | null = null;

    for (const line of lines) {
      const match = line.match(/^a=rtpmap:(\d+)\s+opus\/48000\/2/i);
      if (match) {
        opusPt = match[1];
        break;
      }
    }

    if (!opusPt) return sdp;

    const targetBitrate = mode === 'low-data' ? 12000 : 24000;
    const usedtx = mode === 'low-data' ? '1' : '0';
    let fmtpFound = false;

    const modifiedLines = lines.map((line) => {
      if (line.startsWith(`a=fmtp:${opusPt} `)) {
        fmtpFound = true;
        let params = line.replace(`a=fmtp:${opusPt} `, '').trim();
        if (/maxaveragebitrate=\d+/.test(params)) {
          params = params.replace(/maxaveragebitrate=\d+/, `maxaveragebitrate=${targetBitrate}`);
        } else {
          params += `;maxaveragebitrate=${targetBitrate}`;
        }
        if (/usedtx=\d+/.test(params)) {
          params = params.replace(/usedtx=\d+/, `usedtx=${usedtx}`);
        } else {
          params += `;usedtx=${usedtx}`;
        }
        if (!/stereo=\d+/.test(params)) {
          params += ';stereo=0;sprop-stereo=0';
        }
        if (!/useinbandfec=1/.test(params)) {
          params += ';useinbandfec=1';
        }
        return `a=fmtp:${opusPt} ${params}`;
      }
      return line;
    });

    if (!fmtpFound) {
      const rtpmapIdx = modifiedLines.findIndex((l) => l.startsWith(`a=rtpmap:${opusPt} `));
      if (rtpmapIdx !== -1) {
        const fmtpLine = `a=fmtp:${opusPt} minptime=10;useinbandfec=1;maxaveragebitrate=${targetBitrate};usedtx=${usedtx};stereo=0;sprop-stereo=0`;
        modifiedLines.splice(rtpmapIdx + 1, 0, fmtpLine);
      }
    }

    return modifiedLines.join('\r\n');
  }

  /**
   * Apply target ceiling to audio sender parameters (Standard: 24 kbps, Data Saver: 12 kbps)
   */
  async applySenderBitrateLimit(sender: RTCRtpSender, targetBps: number = 24000): Promise<void> {
    try {
      const params = sender.getParameters();
      if (!params.encodings || params.encodings.length === 0) {
        params.encodings = [{}];
      }

      params.encodings[0].maxBitrate = targetBps;
      params.encodings[0].priority = 'high';
      params.encodings[0].networkPriority = 'high';
      await sender.setParameters(params);
      console.log(`[NegotiationController] Applied ${targetBps} bps ceiling to audio sender`);
    } catch (err) {
      console.warn('[NegotiationController] Could not apply sender bitrate limit:', err);
    }
  }

  /**
   * Invalidate current queue during hard reset
   */
  resetQueue() {
    this.queue = [];
    this.inFlightNegotiation = false;
  }
}

export const negotiationController = new NegotiationController();
