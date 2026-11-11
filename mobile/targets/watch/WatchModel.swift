import Foundation
import SwiftUI
import WidgetKit

// The watch app's state: linking with a code, today's goals and water
// from Hound, and the live numbers from Health. Each refresh also saves
// the complications' snapshot and asks them to redraw.
@MainActor
final class WatchModel: ObservableObject {
  enum Phase { case starting, pairing, linked }

  @Published var phase: Phase = .starting
  @Published var code: String? = nil
  @Published var today: WatchToday? = nil
  @Published var health = TodayHealth()
  @Published var problem: String? = nil
  @Published var busy = false

  private var polling: Task<Void, Never>? = nil

  // On launch: linked already, or start pairing.
  func start() async {
    if WatchIdentity.deviceId != nil {
      phase = .linked
      await HealthReader.shared.requestAccess()
      await refresh()
    } else {
      await beginPairing()
    }
  }

  func beginPairing() async {
    phase = .pairing
    problem = nil
    code = nil
    do {
      let started = try await HoundAPI.rpc("watch_pair_start", ["p_secret": WatchIdentity.secret], as: PairStart.self)
      WatchIdentity.deviceId = started.device_id
      code = started.code
      poll()
    } catch {
      problem = error.localizedDescription
    }
  }

  // Every 3 seconds until the code is entered on the phone (15 minutes).
  private func poll() {
    polling?.cancel()
    polling = Task { [weak self] in
      for _ in 0..<300 {
        try? await Task.sleep(nanoseconds: 3_000_000_000)
        guard let self, !Task.isCancelled, let device = WatchIdentity.deviceId else { return }
        let result = try? await HoundAPI.rpc("watch_pair_status", ["p_device": device, "p_secret": WatchIdentity.secret], as: PairStatus?.self)
        if let status = result ?? nil {
          if status.linked {
            self.phase = .linked
            await HealthReader.shared.requestAccess()
            await self.refresh()
            return
          }
          if status.expired == true {
            self.code = nil
            self.problem = "That code ran out. Tap New code."
            return
          }
        }
      }
    }
  }

  func refresh() async {
    guard let device = WatchIdentity.deviceId else { return }
    health = await HealthReader.shared.today()
    do {
      today = try await HoundAPI.rpc("watch_today", ["p_device": device, "p_secret": WatchIdentity.secret, "p_day": localDayKey()], as: WatchToday.self)
      problem = nil
    } catch {
      // Unlinked on the phone: start over with a new code.
      if error.localizedDescription.contains("isn't linked") {
        WatchIdentity.forget()
        today = nil
        saveSnapshot(linked: false)
        await beginPairing()
        return
      }
      problem = error.localizedDescription
    }
    saveSnapshot(linked: true)
  }

  func addWater() async {
    await changeWater("watch_log_water")
  }

  func undoWater() async {
    await changeWater("watch_undo_water")
  }

  private func changeWater(_ fn: String) async {
    guard let device = WatchIdentity.deviceId, !busy else { return }
    busy = true
    defer { busy = false }
    do {
      let total = try await HoundAPI.rpc(fn, ["p_device": device, "p_secret": WatchIdentity.secret, "p_day": localDayKey()], as: Int.self)
      if let w = today?.water {
        today = WatchToday(
          name: today?.name,
          goals: today?.goals ?? [],
          water: WatchToday.Water(target_ml: w.target_ml, glass_ml: w.glass_ml, units: w.units, today_ml: total),
          streak: today?.streak
        )
      } else {
        await refresh()
      }
      problem = nil
      saveSnapshot(linked: true)
    } catch {
      problem = error.localizedDescription
    }
  }

  // ── What the rings show ──

  struct Ring: Identifiable {
    let id: String
    let label: String
    let value: Double
    let target: Double
    let text: String
    let color: Color
    var fraction: Double { target > 0 ? min(1, value / target) : 0 }
    var done: Bool { value >= target }
  }

  // The daily goals (up to three), then water when there's a water goal.
  var rings: [Ring] {
    var out: [Ring] = []
    let colors: [Color] = [Color(red: 0.57, green: 0.52, blue: 0.85), Color(red: 0.50, green: 0.83, blue: 0.61), Color(red: 0.88, green: 0.66, blue: 0.31)]
    for (i, goal) in (today?.goals ?? []).filter({ $0.period == "day" }).prefix(3).enumerated() {
      let value: Double
      let text: String
      switch goal.metric {
      case "steps":
        value = health.steps
        text = "\(Int(health.steps).formatted()) / \(shortCount(goal.target))"
      case "distance_mi":
        value = health.distanceMi
        text = String(format: "%.1f / %.1f mi", health.distanceMi, goal.target)
      case "workout_minutes":
        value = health.exerciseMinutes
        text = "\(Int(health.exerciseMinutes)) / \(Int(goal.target)) min"
      default:
        value = Double(health.workouts)
        text = health.workouts >= Int(goal.target) ? "Workout ✓" : "\(health.workouts) / \(Int(goal.target)) workouts"
      }
      out.append(Ring(id: "goal\(i)", label: goal.label ?? goal.metric, value: value, target: goal.target, text: text, color: colors[i % colors.count]))
    }
    if let w = today?.water {
      out.append(Ring(id: "water", label: "Water", value: Double(w.today_ml), target: Double(w.target_ml), text: waterText(w), color: Color(red: 0.31, green: 0.70, blue: 0.94)))
    }
    return out
  }

  func waterText(_ w: WatchToday.Water) -> String {
    if w.units == "ml" {
      return "\(w.today_ml.formatted()) / \(w.target_ml.formatted()) ml"
    }
    let cups = Int((Double(w.today_ml) / 237).rounded())
    let goal = Int((Double(w.target_ml) / 237).rounded())
    return "\(cups) / \(goal) cups"
  }

  private func saveSnapshot(linked: Bool) {
    let goals = rings.filter { $0.id != "water" }
    var snap = HoundSnapshot()
    snap.steps = health.steps
    snap.stepGoal = today?.goals.first(where: { $0.metric == "steps" && $0.period == "day" })?.target
    snap.waterMl = today?.water?.today_ml ?? 0
    snap.waterGoalMl = today?.water?.target_ml
    snap.waterUnits = today?.water?.units ?? "cups"
    snap.goalsDone = goals.filter { $0.done }.count
    snap.goalsTotal = goals.count
    snap.streak = today?.streak?.streak
    snap.linked = linked
    snap.updated = Date()
    snap.save()
    WidgetCenter.shared.reloadAllTimelines()
  }
}
