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
