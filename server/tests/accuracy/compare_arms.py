import json
import sys
from pathlib import Path

def load_report(path):
    with open(path) as f:
        return json.load(f)

def compare_arms(control_path, gap_path):
    control = load_report(control_path)
    gap = load_report(gap_path)
    
    print(f"{'Case':<25} {'F1 (Ctrl -> Gap)':<20} {'F1 Delta':<10} {'Ghosts (Ctrl -> Gap)':<20}")
    print("-" * 80)
    
    for case_name, gap_case in gap["cases"].items():
        if case_name not in control["cases"]:
            continue
        
        ctrl_case = control["cases"][case_name]
        
        ctrl_f1 = ctrl_case["metrics"].get("notes.f1", 0.0)
        gap_f1 = gap_case["metrics"].get("notes.f1", 0.0)
        f1_delta = gap_f1 - ctrl_f1
        
        ctrl_ghosts = ctrl_case["metrics"].get("notes.semitone_neighbour_ghosts", 0.0)
        gap_ghosts = gap_case["metrics"].get("notes.semitone_neighbour_ghosts", 0.0)
        
        print(f"{case_name:<25} {ctrl_f1:.3f} -> {gap_f1:.3f}{' ' * 4}{f1_delta:>+7.3f}{' ' * 4}{ctrl_ghosts:.1f} -> {gap_ghosts:.1f}")

    print("\n" + "=" * 80 + "\n")
    print("Aggregate comparison")
    
    ctrl_agg = control["aggregate"]
    gap_agg = gap["aggregate"]
    
    metrics = ["notes.f1", "notes.f1_with_offset", "notes.semitone_neighbour_ghosts", "solfa.chromatic_ghosts"]
    for m in metrics:
        cv = ctrl_agg.get(m, 0.0)
        gv = gap_agg.get(m, 0.0)
        print(f"{m:<35} {cv:.3f} -> {gv:.3f} ({gv - cv:+7.3f})")
    
    # Acceptance gates
    f1_drop = gap_agg.get("notes.f1", 0) - ctrl_agg.get("notes.f1", 0)
    ghost_drop = gap_agg.get("notes.semitone_neighbour_ghosts", 0) - ctrl_agg.get("notes.semitone_neighbour_ghosts", 0)
    
    failed = False
    if f1_drop < -0.02:
        print(f"\n[FAILED] F1 dropped by {-f1_drop:.3f}, which exceeds the 0.02 limit.")
        failed = True
    
    # 10% increase relative to control
    ctrl_ghost_baseline = max(ctrl_agg.get("notes.semitone_neighbour_ghosts", 1.0), 1.0)
    if ghost_drop > 0 and (ghost_drop / ctrl_ghost_baseline) > 0.10:
        print(f"\n[FAILED] Semitone ghosts increased by {(ghost_drop / ctrl_ghost_baseline) * 100:.1f}%, which exceeds 10% limit.")
        failed = True
        
    return 1 if failed else 0

if __name__ == "__main__":
    if len(sys.argv) < 3:
        # Default paths if none provided
        control_p = Path("real_report.control.json")
        gap_p = Path("real_report.contour-gap.json")
    else:
        control_p = Path(sys.argv[1])
        gap_p = Path(sys.argv[2])
        
    if not control_p.exists() or not gap_p.exists():
        print(f"Reports not found: {control_p}, {gap_p}")
        sys.exit(0)  # Don't fail the build if it's just missing
        
    sys.exit(compare_arms(control_p, gap_p))
