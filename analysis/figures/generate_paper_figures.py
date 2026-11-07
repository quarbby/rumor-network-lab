"""Regenerate the manuscript's vector figures from its stored result files.

Run from any directory with Python, matplotlib, and numpy installed.
No simulation or model API is invoked. Baseline variability comes from
results_audit.json, produced by audit_manuscript_results.cjs. LLM dots
come from completed replications in the original checkpoints.
"""

import json
import os
import hashlib
from pathlib import Path

os.environ.setdefault("MPLCONFIGDIR", "/tmp/rumor-network-lab-matplotlib")
import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.patches import FancyArrowPatch, FancyBboxPatch
import numpy as np

OUT = Path(__file__).resolve().parent
ROOT = OUT.parent.parent
BLUE, ORANGE, PURPLE, INK = "#176B91", "#B85C23", "#72539A", "#263746"
plt.rcParams.update({
    "font.family": "DejaVu Sans", "font.size": 11,
    "axes.labelsize": 11, "axes.titlesize": 12, "axes.titleweight": "bold",
    "axes.spines.top": False, "axes.spines.right": False,
    "axes.edgecolor": "#7B8790", "text.color": INK,
    "axes.labelcolor": INK, "xtick.color": INK, "ytick.color": INK,
    "pdf.fonttype": 42, "ps.fonttype": 42,
})


def read(relative):
    return json.loads((ROOT / relative).read_text())


def save(fig, name):
    fig.savefig(OUT / f"{name}.pdf", bbox_inches="tight", pad_inches=0.08)
    plt.close(fig)


def local_results():
    data = read("results.json")
    audit = json.loads((OUT.parent / "results_audit.json").read_text())
    assert audit["reproducedRuns"] == 144 and audit["maximumNumericDifference"] == 0
    assert hashlib.sha256((ROOT / "experiment.cjs").read_bytes()).hexdigest() == audit["provenance"]["sourceSHA256"]
    assert hashlib.sha256((ROOT / "results.json").read_bytes()).hexdigest() == audit["provenance"]["resultsSHA256"]
    fig, axes = plt.subplots(1, 3, figsize=(10.2, 3.4), sharey=True)
    specs = [
        ("exp1_badBotOnly", "alpha1", "A. Rumor-spreading actors", BLUE,
         "Rumor actors / humans ($\\alpha_1$)"),
        ("exp2_correctionBots", "alpha2", "B. Correction-role actors", ORANGE,
         "Correction / rumor actors ($\\alpha_2$)"),
        ("exp3_goodBots", "alpha3", "C. Proactive-role actors", PURPLE,
         "Proactive / rumor actors ($\\alpha_3$)"),
    ]
    for ax, (key, param, title, color, xlabel) in zip(axes, specs):
        rows = data["experiments"][key]
        x = [r[param] for r in rows]
        y = [r["meanFinalBadFraction"] for r in rows]
        deviations = [r["sdFinalBadFraction"] for r in audit["experiments"][key]]
        assert np.allclose(y, [r["meanFinalBadFraction"] for r in audit["experiments"][key]])
        assert all(r["nRuns"] == 8 for r in rows)
        ax.errorbar(x, y, yerr=deviations, fmt="o-", color=color,
                    lw=2, ms=5, capsize=3, elinewidth=1)
        ax.set(title=title, xlabel=xlabel, ylim=(-0.035, 1.055))
        ax.set_xticks(x[::2] + [x[-1]])
        ax.set_yticks(np.arange(0, 1.01, 0.25))
        ax.grid(axis="y", alpha=0.18)
        for idx, offset in [(0, 10), (-1, -18 if y[-1] > .9 else 10)]:
            label_y = y[idx] if offset < 0 else y[idx] + deviations[idx]
            ax.annotate(f"{y[idx]:.3f}", (x[idx], label_y),
                        xytext=(0, offset), textcoords="offset points",
                        ha="center", fontsize=10, color=color)
    axes[0].set_ylabel("Mean final rumor-accepting fraction")
    fig.subplots_adjust(left=.075, right=.985, bottom=.22, top=.86, wspace=.21)
    fig.text(.075, .98, "Probability baseline: 300 humans; 8 seeded replications; bars show mean +/- 1 SD",
             va="top", fontsize=11)
    save(fig, "paper_local_results")


def pilot_results():
    generated = read("llm/experiment3-llm-results.json")
    hosted = read("llm/experiment3-full-real-results.GLM53FLASHX.json")
    local = read("llm/experiment3-full-real-results.json")
    fig, (ax, usage) = plt.subplots(1, 2, figsize=(10.2, 4.1),
                                  gridspec_kw={"width_ratios": [1.3, 1]})
    rows = generated["results"]
    xs = [r["alpha3"] for r in rows]
    means = [np.mean([v["finalBadFraction"] for v in r["runs"]]) for r in rows]
    for r in rows:
        values = [v["finalBadFraction"] for v in r["runs"]]
        assert np.isclose(np.mean(values), r["meanFinalBadFraction"])
        offsets = np.linspace(-.045, .045, len(values))
        ax.scatter(np.array([r["alpha3"]] * len(values)) + offsets, values,
                   s=40, color="#B8A7CE", edgecolor=PURPLE, linewidth=.7,
                   zorder=3)
        ax.text(r["alpha3"], .565, f"n={len(values)}", ha="center", fontsize=9)
    ax.plot(xs, means, "D-", color=PURPLE, ms=5, lw=2, label="Mean", zorder=4)
    ax.scatter([], [], s=35, color="#B8A7CE", edgecolor=PURPLE,
               label="Individual replication")
    ax.set(title="A. GLM generation", xlabel="Proactive / rumor actors ($\\alpha_3$)",
           ylabel="Final rumor-accepting fraction", ylim=(-.025, .61), xlim=(-.15, 2.15))
    ax.set_xticks(xs)
    ax.set_yticks(np.arange(0, .51, .1))
    ax.grid(axis="y", alpha=.18)
    ax.legend(loc="upper right", bbox_to_anchor=(1, .88), frameon=False, fontsize=9)
    ax.text(.5, -.27, "10 humans; 4 steps; Probability baseline; 14-attempt cap\n"
            "Dots are slightly offset horizontally for visibility.",
            transform=ax.transAxes, ha="center", va="top", fontsize=9, color="#53616C")

    # Attribute calls to completed replications, not aggregate checkpoint usage.
    hosted_runs = [r for p in hosted["results"] for r in p["runs"]]
    local_runs = [r for p in local["results"] for r in p["runs"]]
    assert len(hosted_runs) == 3 and len(local_runs) == 8
    assert all(r["genCalls"] == 7 and r["judgeCalls"] == 53 for r in hosted_runs)
    assert all(r["genCalls"] == 0 for r in local_runs)
    gen_mean = [np.mean([r["genCalls"] for r in rs]) for rs in [hosted_runs, local_runs]]
    judge_mean = [np.mean([r["judgeCalls"] for r in rs]) for rs in [hosted_runs, local_runs]]
    y = np.array([1, 0])
    usage.barh(y, gen_mean, color=PURPLE, height=.43, label="Message authorship")
    usage.barh(y, judge_mean, left=gen_mean, color=BLUE, height=.43, label="Judgment")
    usage.text(3.5, 1, "7", ha="center", va="center", color="white", fontsize=10)
    usage.text(7 + 53 / 2, 1, "53", ha="center", va="center", color="white")
    usage.text(judge_mean[1] / 2, 0, f"{judge_mean[1]:.2f}", ha="center", va="center", color="white")
    usage.set(title="B. Two-tier inference calls", xlabel="Mean calls per completed replication",
              yticks=y, yticklabels=["GLM-5.3-FlashX\n3 completed runs", "Qwen2.5-7B-Instruct-1M\n8 completed runs"],
              xlim=(0, 65), ylim=(-.7, 1.65))
    usage.set_xticks([0, 20, 40, 60])
    usage.tick_params(axis="y", labelsize=9)
    usage.grid(axis="x", alpha=.18)
    usage.set_axisbelow(True)
    usage.legend(loc="upper center", bbox_to_anchor=(.5, -.19), frameon=False, fontsize=9)
    usage.text(.5, -.37, "GLM: OpenRouter; Qwen: local LM Studio.\n"
               "", transform=usage.transAxes,
               ha="center", va="top", fontsize=9, color="#53616C")
    fig.subplots_adjust(left=.075, right=.985, top=.88, bottom=.29, wspace=.53)
    save(fig, "paper_pilot_results")


def jev_speedup():
    """Project fixed-trace service time; latency inputs are assumptions."""
    record = read("llm/experiment3-full-real-results.GLM53FLASHX.json")
    trace = record["results"][0]["runs"][0]
    messages, judgments = trace["genCalls"], trace["judgeCalls"]
    assert (messages, judgments) == (7, 53)
    fig, axes = plt.subplots(1, 2, figsize=(10.2, 3.6), sharex=True)
    cases = [(2., .07, "A. Lower latency inputs"),
             (4., .5, "B. Upper latency inputs")]
    for ax, (generation_latency, jev_latency, title) in zip(axes, cases):
        author_time = messages * generation_latency
        decision_time = np.array([judgments * generation_latency, judgments * jev_latency])
        totals = author_time + decision_time
        ax.barh([1, 0], [author_time, author_time], color=PURPLE,
                height=.43, label="Message authorship")
        ax.barh([1, 0], decision_time, left=author_time, color=BLUE,
                height=.43, label="Judgments")
        for y, value in zip([1, 0], totals):
            ax.text(value + 4, y, f"{value:g} s", va="center", fontsize=11)
        ratio = totals[0] / totals[1]
        ax.text(.98, .94, f"{ratio:.1f}x faster", transform=ax.transAxes,
                ha="right", va="top", fontsize=13, weight="bold", color=BLUE)
        ax.set(title=title, xlabel="Projected sequential inference time (seconds)",
               yticks=[1, 0], yticklabels=["Without Jev", "With Jev"],
               xlim=(0, 280), ylim=(-.5, 1.65))
        ax.set_xticks([0, 60, 120, 180, 240])
        ax.grid(axis="x", alpha=.18)
        ax.set_axisbelow(True)
        ax.text(.5, -.35,
                f"Generative call: {generation_latency:g} s; Jev judgment: {jev_latency:g} s",
                transform=ax.transAxes, ha="center", fontsize=10, color="#53616C")
    fig.subplots_adjust(left=.10, right=.98, top=.83, bottom=.32, wspace=.31)
    fig.text(.10, .98, "Fixed workload: 7 authored messages and 53 judgments",
             va="top", fontsize=11)
    axes[1].legend(loc="upper right", bbox_to_anchor=(1., -.51),
                   ncol=2, frameon=False, fontsize=9)
    save(fig, "paper_jev_speedup")


def methodology():
    fig, axes = plt.subplots(1, 2, figsize=(10.2, 6.3))
    for ax in axes:
        ax.set(xlim=(0, 1), ylim=(0, 1))
        ax.axis("off")

    def box(ax, y, title, detail, color, fill):
        x, w, h = .10, .79, .105
        ax.add_patch(FancyBboxPatch((x, y-h/2), w, h,
            boxstyle="round,pad=0.009,rounding_size=.015", linewidth=1.1,
            edgecolor=color, facecolor=fill))
        ax.text(x+.035, y+.019, title, ha="left", va="center",
                fontsize=11, weight="bold", color=color)
        ax.text(x+.035, y-.022, detail, ha="left", va="center", fontsize=10, color=INK)

    def arrow(ax, start, end, **kw):
        ax.add_patch(FancyArrowPatch(start, end, arrowstyle="-|>",
                     mutation_scale=12, linewidth=1.2, color="#637583", **kw))

    ys = [.85, .70, .55, .40, .25, .10]
    left = [
        ("1  Define the research comparison", "Intervention, outcome, scope of claims"),
        ("2  Specify agents and network", "Roles, initial beliefs, graph, update rules"),
        ("3  Check a local baseline", "Seeded runs and a readable event trace"),
        ("4  Add role-conditioned language", "Bound prompts; inspect returned messages"),
        ("5  Separate the decision tier", "Probability rules or LLM judgments"),
        ("6  Evaluate and refine", "Behavior, activity, sensitivity, time, cost"),
    ]
    right = [
        ("Agent state + network at step t", "Controller supplies the available context", INK, "#F0F3F5"),
        ("Judge whether the actor speaks", "A closed gate produces no new message", BLUE, "#EDF5F9"),
        ("Author a message if the gate opens", "Generative tier: role + bounded context", PURPLE, "#F3EFF8"),
        ("Judge sharing and route exposures", "Targets / neighbors; attention / persuasion", BLUE, "#EDF5F9"),
        ("Accumulate exposure scores", "Signed effects of accepted exposures", BLUE, "#EDF5F9"),
        ("Commit state + write the event log", "Advance to step t + 1", INK, "#F0F3F5"),
    ]
    axes[0].text(.10, .98, "A. Research workflow", fontsize=13, weight="bold", va="top")
    axes[1].text(.10, .98, "B. LAND interaction loop", fontsize=13, weight="bold", va="top")
    for y, (title, detail) in zip(ys, left):
        box(axes[0], y, title, detail, INK, "#F5F7F8")
    for y, (title, detail, color, fill) in zip(ys, right):
        box(axes[1], y, title, detail, color, fill)
    for ax in axes:
        for a, b in zip(ys[:-1], ys[1:]):
            arrow(ax, (.495, a-.063), (.495, b+.063))
    # Feedback arrows run outside the boxes, never through their text.
    for ax, label in [(axes[0], "revise"), (axes[1], "next step")]:
        ax.plot([.90, .97, .97, .90], [.10, .10, .85, .85],
                color="#637583", lw=1.1)
        arrow(ax, (.94, .85), (.90, .85))
        ax.text(.985, .475, label, rotation=90, ha="center", va="center",
                fontsize=9, color="#53616C")
    fig.subplots_adjust(left=.01, right=.98, top=.98, bottom=.01, wspace=.12)
    save(fig, "paper_methodology")


if __name__ == "__main__":
    methodology()
    local_results()
    pilot_results()
    jev_speedup()
    print("Regenerated four manuscript figures from stored results and stated latency inputs.")
