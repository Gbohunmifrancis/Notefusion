import sys
from pathlib import Path
import csv

def summarise(results_dir: Path):
    levels = [1, 2, 4, 8, 16]
    
    print(f"\n{'Concurrency':<12} {'Req/s':<10} {'Failures':<10} {'p50 (ms)':<10} {'p95 (ms)':<10} {'p99 (ms)':<10}")
    print("-" * 65)
    
    for u in levels:
        csv_path = results_dir / f"pro-warm-u{u}_stats.csv"
        if not csv_path.exists():
            continue
            
        with open(csv_path, newline='') as f:
            reader = csv.DictReader(f)
            # Find the 'Aggregated' row or the 'submit_to_terminal' row
            # If 'submit_to_terminal' is available, it's the most important user-facing metric
            terminal_row = None
            agg_row = None
            for row in reader:
                if row.get("Name") == "submit_to_terminal":
                    terminal_row = row
                if row.get("Name") == "Aggregated":
                    agg_row = row
            
            # Use terminal row if available, else fallback to aggregated HTTP requests
            target = terminal_row if terminal_row else agg_row
            if not target:
                print(f"{u:<12} [No Data]")
                continue
                
            reqs = target.get("Requests/s", "N/A")
            fails = target.get("Failures", "N/A")
            p50 = target.get("50%", "N/A")
            p95 = target.get("95%", "N/A")
            p99 = target.get("99%", "N/A")
            
            print(f"{u:<12} {reqs:<10} {fails:<10} {p50:<10} {p95:<10} {p99:<10}")
            
    print("\nBenchmark summary complete.\n")

if __name__ == "__main__":
    if len(sys.argv) < 2:
        d = Path("c:/Users/ADMIN/OneDrive/Desktop/PROJECTS/Note/server/loadtest/results")
    else:
        d = Path(sys.argv[1])
    summarise(d)
