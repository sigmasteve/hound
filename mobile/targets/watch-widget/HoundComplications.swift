import HealthKit
import SwiftUI
import WidgetKit

// Hound's watch-face complications and Smart Stack card:
//   Hound steps   circular ring, corner gauge, inline text
//   Hound water   circular ring with a drop
//   Hound goals   rectangular: goals done, the streak, steps and water bars
// They read the watch app's last snapshot (Snapshot.swift); steps are read
// from Health here too, so they stay current between app opens. Tapping
// any of them opens the watch app.

let houndPurple = Color(red: 0.57, green: 0.52, blue: 0.85)
let waterBlue = Color(red: 0.31, green: 0.70, blue: 0.94)

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

@main
struct HoundComplications: WidgetBundle {
  var body: some Widget {
    StepsComplication()
    WaterComplication()
    GoalsComplication()
  }
}
