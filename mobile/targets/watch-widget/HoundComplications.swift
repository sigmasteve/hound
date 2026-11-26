import HealthKit
import SwiftUI
import WidgetKit

// Hound's watch-face complications and Smart Stack card:
//   Hound steps   circular ring, corner gauge, inline text
//   Hound water   circular ring with a drop
//   Hound goals   rectangular: goals done, the streak, steps and water bars
//   Hound fasting circular ring, corner, rectangular, inline (1.3.0): the
//                 fast's clock (it runs from the start, between updates)
//                 and the ring to the goal
// They read the watch app's last snapshot (Snapshot.swift); steps are read
// from Health here too, so they stay current between app opens. Tapping
// any of them opens the watch app.

let houndPurple = Color(red: 0.57, green: 0.52, blue: 0.85)
let waterBlue = Color(red: 0.31, green: 0.70, blue: 0.94)
let fastAmber = Color(red: 0.88, green: 0.66, blue: 0.31)
let doneGreen = Color(red: 0.50, green: 0.83, blue: 0.61)

struct HoundEntry: TimelineEntry {
  let date: Date
  let snap: HoundSnapshot
}

struct HoundProvider: TimelineProvider {
  func placeholder(in context: Context) -> HoundEntry {
    var snap = HoundSnapshot()
    snap.steps = 8412
    snap.stepGoal = 10000
    snap.waterMl = 1185
    snap.waterGoalMl = 1893
    snap.goalsDone = 2
    snap.goalsTotal = 3
    snap.streak = 12
    snap.linked = true
    return HoundEntry(date: Date(), snap: snap)
  }

  func getSnapshot(in context: Context, completion: @escaping (HoundEntry) -> Void) {
    completion(context.isPreview ? placeholder(in: context) : HoundEntry(date: Date(), snap: HoundSnapshot.load()))
  }

  func getTimeline(in context: Context, completion: @escaping (Timeline<HoundEntry>) -> Void) {
    var snap = HoundSnapshot.load()
    // A new day: yesterday's water and goals don't carry over.
    if !Calendar.current.isDateInToday(snap.updated) {
      snap.waterMl = 0
      snap.goalsDone = 0
    }
    readSteps { steps in
      if let steps { snap.steps = steps }
      let next = Calendar.current.date(byAdding: .minute, value: 15, to: Date()) ?? Date().addingTimeInterval(900)
      completion(Timeline(entries: [HoundEntry(date: Date(), snap: snap)], policy: .after(next)))
    }
  }

  private func readSteps(_ done: @escaping (Double?) -> Void) {
    guard HKHealthStore.isHealthDataAvailable(), let type = HKQuantityType.quantityType(forIdentifier: .stepCount) else {
      done(nil)
      return
    }
    let start = Calendar.current.startOfDay(for: Date())
    let predicate = HKQuery.predicateForSamples(withStart: start, end: Date(), options: .strictStartDate)
    let query = HKStatisticsQuery(quantityType: type, quantitySamplePredicate: predicate, options: .cumulativeSum) { _, result, _ in
      done(result?.sumQuantity()?.doubleValue(for: .count()))
    }
    HKHealthStore().execute(query)
  }
}

// ── Steps ──

struct StepsView: View {
  @Environment(\.widgetFamily) var family
  let entry: HoundEntry

  var body: some View {
    let snap = entry.snap
    switch family {
    case .accessoryCorner:
      Text(Int(snap.steps).formatted())
        .widgetCurvesContent()
        .widgetLabel {
          Gauge(value: snap.stepFraction) { Text("Steps") }
            .tint(houndPurple)
        }
    case .accessoryInline:
      Text("🐾 \(Int(snap.steps).formatted()) steps")
    default:
      Gauge(value: snap.stepFraction) {
        Text("STEPS")
      } currentValueLabel: {
        Text(shortCount(snap.steps))
      }
      .gaugeStyle(.accessoryCircularCapacity)
      .tint(houndPurple)
    }
  }
}

struct StepsComplication: Widget {
  var body: some WidgetConfiguration {
    StaticConfiguration(kind: "HoundSteps", provider: HoundProvider()) { entry in
      StepsView(entry: entry)
        .containerBackground(for: .widget) { Color.clear }
    }
    .configurationDisplayName("Hound steps")
    .description("Today's steps toward your goal.")
    .supportedFamilies([.accessoryCircular, .accessoryCorner, .accessoryInline])
  }
}

// ── Water ──

struct WaterRingView: View {
  let entry: HoundEntry

  var body: some View {
    Gauge(value: entry.snap.waterFraction) {
      Image(systemName: "drop.fill")
    } currentValueLabel: {
      VStack(spacing: 0) {
        Image(systemName: "drop.fill").font(.caption2)
        Text(entry.snap.waterShort).font(.system(size: 11, weight: .bold))
      }
    }
    .gaugeStyle(.accessoryCircularCapacity)
    .tint(waterBlue)
  }
}

struct WaterComplication: Widget {
  var body: some WidgetConfiguration {
    StaticConfiguration(kind: "HoundWater", provider: HoundProvider()) { entry in
      WaterRingView(entry: entry)
        .containerBackground(for: .widget) { Color.clear }
    }
    .configurationDisplayName("Hound water")
    .description("Water today toward your goal. Tap to add a glass.")
    .supportedFamilies([.accessoryCircular])
  }
}

// ── Goals (rectangular, and the Smart Stack) ──

struct GoalsView: View {
  let entry: HoundEntry

  var body: some View {
    let snap = entry.snap
    VStack(alignment: .leading, spacing: 3) {
      HStack {
        Text(snap.linked ? "🐾 HOUND · \(snap.goalsDone) OF \(snap.goalsTotal)" : "🐾 HOUND")
          .font(.system(size: 12, weight: .bold))
          .foregroundStyle(houndPurple)
        Spacer()
        if let streak = snap.streak, streak > 0 {
          Text("🔥 \(streak)").font(.system(size: 12, weight: .bold))
        }
      }
      if snap.linked {
        Bar(label: "Steps", value: "\(Int(snap.steps).formatted())", fraction: snap.stepFraction, color: houndPurple)
        if snap.waterGoalMl != nil {
          Bar(label: "Water", value: snap.waterShort, fraction: snap.waterFraction, color: waterBlue)
        }
      } else {
        Text("Open Hound on your watch to link it.").font(.system(size: 12))
      }
    }
  }
}

struct Bar: View {
  let label: String
  let value: String
  let fraction: Double
  let color: Color

  var body: some View {
    VStack(alignment: .leading, spacing: 1) {
      HStack {
        Text(label).font(.system(size: 12))
        Spacer()
        Text(value).font(.system(size: 12)).foregroundStyle(.secondary)
      }
      ProgressView(value: fraction).tint(color)
    }
  }
}

struct GoalsComplication: Widget {
  var body: some WidgetConfiguration {
    StaticConfiguration(kind: "HoundGoals", provider: HoundProvider()) { entry in
      GoalsView(entry: entry)
        .containerBackground(for: .widget) { Color.clear }
    }
    .configurationDisplayName("Hound goals")
    .description("Today's goals, your streak, steps and water.")
    .supportedFamilies([.accessoryRectangular])
  }
}

// ── Fasting (1.3.0) ──

// An entry every 15 minutes while fasting, and one at the goal, so the
// ring fills and turns green on time; the clock text runs by itself.
struct FastingProvider: TimelineProvider {
  func placeholder(in context: Context) -> HoundEntry {
    var snap = HoundSnapshot()
    snap.linked = true
    snap.fastOk = true
    snap.fastStart = Date().addingTimeInterval(-13.5 * 3600)
    snap.fastGoalHours = 16
    return HoundEntry(date: Date(), snap: snap)
  }

  func getSnapshot(in context: Context, completion: @escaping (HoundEntry) -> Void) {
    completion(context.isPreview ? placeholder(in: context) : HoundEntry(date: Date(), snap: HoundSnapshot.load()))
  }

  func getTimeline(in context: Context, completion: @escaping (Timeline<HoundEntry>) -> Void) {
    let snap = HoundSnapshot.load()
    let now = Date()
    var dates = [now]
    if let end = snap.fastEnd {
      for i in 1...16 {
        let d = now.addingTimeInterval(Double(i) * 900)
        if d < end { dates.append(d) }
      }
      if end > now { dates.append(end) }
    }
    let entries = dates.sorted().map { HoundEntry(date: $0, snap: snap) }
    let next = now.addingTimeInterval(4 * 3600)
    completion(Timeline(entries: entries, policy: .after(next)))
  }
}

struct FastingComplicationView: View {
  @Environment(\.widgetFamily) var family
  let entry: HoundEntry

  var body: some View {
    let snap = entry.snap
    let fraction = snap.fastFraction(at: entry.date)
    let done = snap.fastEnd.map { entry.date >= $0 } ?? false
    let color = done ? doneGreen : fastAmber
    if let start = snap.fastStart, let goal = snap.fastGoalHours {
      switch family {
      case .accessoryInline:
        Text(done ? "🍽 \(goal) h fast done ✓" : "🍽 Fasting \(start, style: .timer)")
      case .accessoryCorner:
        Image(systemName: "fork.knife")
          .widgetLabel {
            Gauge(value: fraction) { Text("Fast") }.tint(color)
          }
      case .accessoryRectangular:
        VStack(alignment: .leading, spacing: 2) {
          Text(done ? "🍽 GOAL REACHED ✓" : "🍽 FASTING · GOAL \(goal) H")
            .font(.system(size: 12, weight: .bold))
            .foregroundStyle(color)
          Text(start, style: .timer).font(.system(size: 18, weight: .semibold, design: .rounded)).monospacedDigit()
          ProgressView(value: fraction).tint(color)
        }
      default:
        Gauge(value: fraction) {
          Image(systemName: "fork.knife")
        } currentValueLabel: {
          Image(systemName: done ? "checkmark" : "fork.knife").font(.caption)
        }
        .gaugeStyle(.accessoryCircularCapacity)
        .tint(color)
      }
    } else {
      switch family {
      case .accessoryInline:
        Text(snap.fastOk == true ? "🍽 Not fasting" : "🍽 Hound fasting")
      case .accessoryRectangular:
        VStack(alignment: .leading, spacing: 2) {
          Text("🍽 FASTING").font(.system(size: 12, weight: .bold)).foregroundStyle(fastAmber)
          Text(snap.fastOk == true ? "Tap to start a \(snap.fastPlanHours ?? 16) h fast" : "Open Hound to set up fasting")
            .font(.system(size: 13))
        }
      default:
        ZStack {
          AccessoryWidgetBackground()
          Image(systemName: "fork.knife")
        }
      }
    }
  }
}

struct FastingComplication: Widget {
  var body: some WidgetConfiguration {
    StaticConfiguration(kind: "HoundFasting", provider: FastingProvider()) { entry in
      FastingComplicationView(entry: entry)
        .containerBackground(for: .widget) { Color.clear }
    }
    .configurationDisplayName("Hound fasting")
    .description("Your fast's clock and the ring to your goal.")
    .supportedFamilies([.accessoryCircular, .accessoryCorner, .accessoryRectangular, .accessoryInline])
  }
}

@main
struct HoundComplications: WidgetBundle {
  var body: some Widget {
    StepsComplication()
    WaterComplication()
    GoalsComplication()
    FastingComplication()
  }
}
