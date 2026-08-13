namespace NoteFusion.Core.Enums;

/// <summary>Processing state of a persisted provider webhook (the inbox row that guarantees exactly-once).</summary>
public enum WebhookStatus
{
    /// <summary>Stored and signature-verified; awaiting the background worker.</summary>
    Received = 1,

    /// <summary>Business effect applied exactly once.</summary>
    Processed = 2,

    /// <summary>Processing failed after retries; parked for inspection and reconciliation.</summary>
    Failed = 3
}
