import SwiftUI

@main
struct HoundWatchApp: App {
  @StateObject private var model = WatchModel()
  @Environment(\.scenePhase) private var scenePhase

  var body: some Scene {
    WindowGroup {
      ContentView()
        .environmentObject(model)
        .task { await model.start() }
        .onChange(of: scenePhase) { _, phase in
          if phase == .active, model.phase == .linked {
            Task { await model.refresh() }
          }
        }
    }
  }
}

let houndPurple = Color(red: 0.57, green: 0.52, blue: 0.85)
let waterBlue = Color(red: 0.31, green: 0.70, blue: 0.94)
let fastAmber = Color(red: 0.88, green: 0.66, blue: 0.31)
let doneGreen = Color(red: 0.50, green: 0.83, blue: 0.61)

struct ContentView: View {
  @EnvironmentObject var model: WatchModel

  var body: some View {
    switch model.phase {
    case .starting:
      ProgressView()
    case .pairing:
      PairView()
    case .linked:
      TabView {
        TodayView()
        // 0274: fasting (once it's set up on the phone, 16 or older) and
        // logging an activity.
        if model.fasting?.age != "under" {
          FastingView()
        }
        ActivityView()
        WaterView()
      }
      .tabViewStyle(.verticalPage)
    }
  }
}

// Linking: the code to enter on the phone.
struct PairView: View {
  @EnvironmentObject var model: WatchModel

  var body: some View {
    ScrollView {
      VStack(spacing: 8) {
        Image(systemName: "pawprint.fill").foregroundStyle(houndPurple).font(.title3)
        Text("Link Hound").font(.headline)
        if let code = model.code {
          Text("\(code.prefix(3))-\(code.suffix(3))")
            .font(.system(size: 30, weight: .bold, design: .rounded))
            .monospaced()
          Text("On your iPhone: Hound → You → Settings → Apple Watch, then enter this code.")
            .font(.footnote)
            .multilineTextAlignment(.center)
            .foregroundStyle(.secondary)
        } else if model.problem == nil {
          ProgressView()
        }
        if let problem = model.problem {
          Text(problem).font(.footnote).foregroundStyle(.orange).multilineTextAlignment(.center)
          Button("New code") { Task { await model.beginPairing() } }
        }
      }
      .padding(.horizontal, 4)
    }
  }
}

// Today: the goal rings with their numbers, and the streak.
struct TodayView: View {
  @EnvironmentObject var model: WatchModel

  var body: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 8) {
        HStack {
          Label("Hound", systemImage: "pawprint.fill").foregroundStyle(houndPurple).font(.footnote.bold())
          Spacer()
        }
        if model.rings.isEmpty && model.today != nil {
          Text("Set goals in Hound on your iPhone to see them here.")
            .font(.footnote)
            .foregroundStyle(.secondary)
        }
        HStack(spacing: 10) {
          RingStack(rings: model.rings).frame(width: 74, height: 74)
          VStack(alignment: .leading, spacing: 3) {
            ForEach(model.rings) { ring in
              HStack(spacing: 4) {
                Circle().fill(ring.color).frame(width: 6, height: 6)
                Text(ring.text).font(.caption2).lineLimit(1).minimumScaleFactor(0.7)
              }
            }
          }
        }
        if let streak = model.today?.streak?.streak, streak > 0 {
          let left = model.rings.filter { $0.id != "water" && !$0.done }.count
          HStack {
            Text("🔥 \(streak)-day streak").font(.footnote.bold())
            Spacer()
            Text(left == 0 ? "Done today" : "\(left) to go").font(.caption2).foregroundStyle(.secondary)
          }
          .padding(8)
          .background(RoundedRectangle(cornerRadius: 12).fill(Color.white.opacity(0.1)))
        }
        if let problem = model.problem {
          Text(problem).font(.caption2).foregroundStyle(.orange)
        }
      }
    }
    .refreshable { await model.refresh() }
  }
}

// Rings inside each other, the first goal outermost.
struct RingStack: View {
  let rings: [WatchModel.Ring]

  var body: some View {
    GeometryReader { geo in
      let size = min(geo.size.width, geo.size.height)
      let width = max(5, size / CGFloat(max(1, rings.count) * 2 + 2))
      ZStack {
        ForEach(Array(rings.enumerated()), id: \.element.id) { index, ring in
          let inset = CGFloat(index) * (width + 2)
          Circle()
            .stroke(ring.color.opacity(0.25), lineWidth: width)
            .padding(inset + width / 2)
          Circle()
            .trim(from: 0, to: ring.fraction)
            .stroke(ring.color, style: StrokeStyle(lineWidth: width, lineCap: .round))
            .rotationEffect(.degrees(-90))
            .padding(inset + width / 2)
        }
      }
      .frame(width: size, height: size)
    }
  }
}

// Water: the glass, and a glass at a tap.
struct WaterView: View {
  @EnvironmentObject var model: WatchModel

  var body: some View {
    VStack(spacing: 8) {
      if let water = model.today?.water {
        GlassShape()
          .fill(Color.white.opacity(0.08))
          .overlay(
            GlassShape()
              .fill(waterBlue)
              .mask(
                GeometryReader { geo in
                  let fraction = water.target_ml > 0 ? min(1, Double(water.today_ml) / Double(water.target_ml)) : 0
                  Rectangle()
                    .frame(height: geo.size.height * fraction)
                    .frame(maxHeight: .infinity, alignment: .bottom)
                }
              )
          )
          .overlay(GlassShape().stroke(Color.white.opacity(0.4), lineWidth: 2))
          .frame(width: 58, height: 72)
        Text(model.waterText(water)).font(.headline)
        HStack(spacing: 6) {
          Button {
            Task { await model.addWater() }
          } label: {
            Text(water.units == "ml" ? "+ \(water.glass_ml) ml" : "+ 1 glass").bold()
          }
          .tint(waterBlue)
          .disabled(model.busy)
          Button("Undo") { Task { await model.undoWater() } }
            .disabled(model.busy || water.today_ml == 0)
            .frame(maxWidth: 60)
        }
      } else {
        Image(systemName: "drop.fill").foregroundStyle(waterBlue).font(.title2)
        Text("Turn on water in Hound on your iPhone (You → Goals) to add glasses from here.")
          .font(.footnote)
          .multilineTextAlignment(.center)
          .foregroundStyle(.secondary)
      }
      if let problem = model.problem {
        Text(problem).font(.caption2).foregroundStyle(.orange)
      }
    }
  }
}

// A glass, wider at the top.
struct GlassShape: Shape {
  func path(in rect: CGRect) -> Path {
    var p = Path()
    p.move(to: CGPoint(x: rect.minX, y: rect.minY))
    p.addLine(to: CGPoint(x: rect.maxX, y: rect.minY))
    p.addLine(to: CGPoint(x: rect.maxX - rect.width * 0.14, y: rect.maxY))
    p.addLine(to: CGPoint(x: rect.minX + rect.width * 0.14, y: rect.maxY))
    p.closeSubpath()
    return p
  }
}

// ── Fasting (0274) ──

// The plans Hound offers (src/fasting/fasting.ts PLANS).
let fastPlans: [(hours: Int, label: String)] = [(12, "12:12"), (13, "13:11"), (14, "14:10"), (16, "16:8"), (18, "18:6"), (20, "20:4"), (23, "One meal")]

func fastPlanLabel(_ hours: Int) -> String {
  fastPlans.first(where: { $0.hours == hours })?.label ?? "\(hours) h"
}

// The fast's clock and ring while fasting (both run from the start time,
// so they stay right with the app closed), End fast; between fasts the
// plan, the streak and Start.
struct FastingView: View {
  @EnvironmentObject var model: WatchModel
  @State private var plan: Int? = nil
  @State private var confirmEnd = false

  var body: some View {
    ScrollView {
      VStack(spacing: 6) {
        if let f = model.fasting, f.age == "ok" {
          if let start = model.fastStart, let goal = f.open?.goal_hours {
            let end = start.addingTimeInterval(Double(goal) * 3600)
            TimelineView(.periodic(from: .now, by: 30)) { context in
              let fraction = min(1, max(0, context.date.timeIntervalSince(start) / (Double(goal) * 3600)))
              let done = context.date >= end
              ZStack {
                Circle().stroke(fastAmber.opacity(0.25), lineWidth: 8)
                Circle()
                  .trim(from: 0, to: fraction)
                  .stroke(done ? doneGreen : fastAmber, style: StrokeStyle(lineWidth: 8, lineCap: .round))
                  .rotationEffect(.degrees(-90))
                VStack(spacing: 0) {
                  Text(done ? "GOAL ✓" : "FASTING").font(.system(size: 10, weight: .bold)).foregroundStyle(done ? doneGreen : fastAmber)
                  Text(start, style: .timer).font(.system(size: 20, weight: .semibold, design: .rounded)).monospacedDigit()
                }
              }
              .frame(width: 96, height: 96)
            }
            Text("Goal \(goal) h · ends \(end.formatted(date: .omitted, time: .shortened))")
              .font(.caption2)
              .foregroundStyle(.secondary)
            Button(role: .destructive) {
              confirmEnd = true
            } label: {
              Text("End fast").bold()
            }
            .disabled(model.busy)
            .confirmationDialog("End your fast now?", isPresented: $confirmEnd) {
              Button("End fast", role: .destructive) { Task { await model.endFast() } }
              Button("Keep going", role: .cancel) {}
            }
          } else {
            let hours = plan ?? f.plan_hours
            Image(systemName: "fork.knife.circle.fill").font(.title2).foregroundStyle(fastAmber)
            if let note = model.fastNote {
              Text(note).font(.footnote).multilineTextAlignment(.center)
            }
            HStack {
              Button {
                if let i = fastPlans.firstIndex(where: { $0.hours == hours }), i > 0 { plan = fastPlans[i - 1].hours }
              } label: { Image(systemName: "minus") }
              .frame(width: 36)
              VStack(spacing: 0) {
                Text(fastPlanLabel(hours)).font(.headline)
                Text("\(hours) h").font(.caption2).foregroundStyle(.secondary)
              }
              .frame(maxWidth: .infinity)
              Button {
                if let i = fastPlans.firstIndex(where: { $0.hours == hours }), i < fastPlans.count - 1 { plan = fastPlans[i + 1].hours }
              } label: { Image(systemName: "plus") }
              .frame(width: 36)
            }
            Button {
              Task { await model.startFast(hours: hours) }
            } label: {
              Text("Start \(hours) h fast").bold()
            }
            .tint(fastAmber)
            .disabled(model.busy)
            if let streak = f.streak, streak > 0 {
              Text("🔥 \(streak)-day streak").font(.caption2.bold())
            }
          }
        } else {
          Image(systemName: "fork.knife.circle.fill").font(.title2).foregroundStyle(fastAmber)
          Text("Open Fasting in Hound on your iPhone once to start fasting from here.")
            .font(.footnote)
            .multilineTextAlignment(.center)
            .foregroundStyle(.secondary)
        }
        if let problem = model.problem {
          Text(problem).font(.caption2).foregroundStyle(.orange).multilineTextAlignment(.center)
        }
      }
    }
  }
}

// ── Log an activity (0274) ──

// The kinds Log a workout offers (src/workouts/loggedWorkouts.ts), the
// ones people log most first.
struct ActivityType: Identifiable {
  let id: String
  let label: String
}

let activityTypes: [ActivityType] = [
  ("strength", "Strength"), ("yoga", "Yoga"), ("hiit", "HIIT"), ("pilates", "Pilates"), ("spin", "Spin class"),
  ("dance", "Dance"), ("elliptical", "Elliptical"), ("stretching", "Stretching"), ("pickleball", "Pickleball"),
  ("tennis", "Tennis"), ("basketball", "Basketball"), ("soccer", "Soccer"), ("golf", "Golf"), ("swim", "Swim"),
  ("rowing", "Rowing"), ("cycle", "Cycling"), ("run", "Run"), ("walk", "Walk"), ("housework", "Housework"), ("other", "Other"),
].map { ActivityType(id: $0.0, label: $0.1) }

// What, how long, Log: it ends now and counts like Log a workout on the
// phone (Move points, goals, challenges). Undo for 15 minutes.
struct ActivityView: View {
  @EnvironmentObject var model: WatchModel
  @State private var type = "strength"
  @State private var minutes = 30

  var body: some View {
    ScrollView {
      VStack(spacing: 6) {
        Label("Log activity", systemImage: "plus.circle.fill").font(.footnote.bold()).foregroundStyle(houndPurple)
        Picker("Activity", selection: $type) {
          ForEach(activityTypes) { t in
            Text(t.label).tag(t.id)
          }
        }
        .pickerStyle(.wheel)
        .frame(height: 54)
        Stepper(value: $minutes, in: 5...90, step: 5) {
          Text("\(minutes) min").font(.headline)
        }
        Button {
          let label = activityTypes.first(where: { $0.id == type })?.label ?? "Activity"
          Task { await model.logActivity(type: type, label: label, minutes: minutes) }
        } label: {
          Text("Log it").bold()
        }
        .tint(houndPurple)
        .disabled(model.busy)
        if let last = model.lastActivity, Date().timeIntervalSince(last.at) < 15 * 60 {
          HStack {
            Text("✓ \(last.text)").font(.caption2).lineLimit(2)
            Spacer()
            Button("Undo") { Task { await model.undoActivity() } }
              .font(.caption2)
              .frame(width: 56)
              .disabled(model.busy)
          }
        }
        if let problem = model.problem {
          Text(problem).font(.caption2).foregroundStyle(.orange).multilineTextAlignment(.center)
        }
      }
    }
  }
}
