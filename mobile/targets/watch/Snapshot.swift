import Foundation

// What the complications show, saved by the watch app each time it
// refreshes, in the App Group the complications can read. A copy of this
// file is in targets/watch-widget (each target only builds its own
// folder); keep the two the same.
struct HoundSnapshot: Codable {
  var steps: Double = 0
  var stepGoal: Double? = nil
  var waterMl: Int = 0
  var waterGoalMl: Int? = nil
  var waterUnits: String = "cups"
  var goalsDone: Int = 0
  var goalsTotal: Int = 0
  var streak: Int? = nil
  var linked: Bool = false
  var updated: Date = Date()
  // Fasting (0274): the open fast's start and goal, or none; whether
  // fasting's set up (16 or older) and the plan to start on.
  var fastStart: Date? = nil
  var fastGoalHours: Int? = nil
  var fastOk: Bool? = nil
  var fastPlanHours: Int? = nil

  var fastEnd: Date? {
    guard let start = fastStart, let goal = fastGoalHours else { return nil }
    return start.addingTimeInterval(Double(goal) * 3600)
  }

  func fastFraction(at date: Date) -> Double {
    guard let start = fastStart, let goal = fastGoalHours, goal > 0 else { return 0 }
    return min(1, max(0, date.timeIntervalSince(start) / (Double(goal) * 3600)))
  }

  // group.<the phone app's bundle id>.watch, worked out from this
  // target's own id (app.hound.mobile.watchkitapp[.complications]), so
  // Hound Staging's watch uses its own group.
  static var groupId: String {
    let id = Bundle.main.bundleIdentifier ?? "app.hound.mobile.watchkitapp"
    let base = id.components(separatedBy: ".watchkitapp").first ?? "app.hound.mobile"
    return "group.\(base).watch"
  }
  static let key = "houndSnapshot"

  static func load() -> HoundSnapshot {
    guard let defaults = UserDefaults(suiteName: groupId),
          let data = defaults.data(forKey: key),
          let snap = try? JSONDecoder().decode(HoundSnapshot.self, from: data) else {
      return HoundSnapshot()
    }
    return snap
  }

  func save() {
    guard let defaults = UserDefaults(suiteName: HoundSnapshot.groupId),
          let data = try? JSONEncoder().encode(self) else { return }
    defaults.set(data, forKey: HoundSnapshot.key)
  }

  // "5/8" cups, or "1.2/2 L".
  var waterShort: String {
    if waterUnits == "ml" {
      let goal = Double(waterGoalMl ?? 2000) / 1000
      return String(format: "%.1f/%.0f L", Double(waterMl) / 1000, goal)
    }
    let cups = Int((Double(waterMl) / 237).rounded())
    let goal = Int((Double(waterGoalMl ?? 1893) / 237).rounded())
    return "\(cups)/\(goal)"
  }

  var waterFraction: Double {
    guard let goal = waterGoalMl, goal > 0 else { return 0 }
    return min(1, Double(waterMl) / Double(goal))
  }

  var stepFraction: Double {
    guard let goal = stepGoal, goal > 0 else { return 0 }
    return min(1, steps / goal)
  }
}

// "8.4k", "12k", "950".
func shortCount(_ n: Double) -> String {
  if n >= 10_000 { return String(format: "%.0fk", n / 1000) }
  if n >= 1_000 { return String(format: "%.1fk", n / 1000) }
  return String(Int(n))
}
