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
   * Apply 24 kbps requested ceiling to audio sender parameters as specified by F5 Section 10
   */
  async applySenderBitrateLimit(sender: RTCRtpSender, targetBps: number = 24000): Promise<void> {
    try {
      const params = sender.getParameters();
      if (!params.encodings || params.encodings.length === 0) {
        params.encodings = [{}];
      }

      params.encodings[0].maxBitrate = targetBps;
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
