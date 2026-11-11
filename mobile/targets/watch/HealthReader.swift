import Foundation
import HealthKit

// Today's steps, distance, exercise minutes and workouts, read on the
// watch itself, so the rings are live without the phone.
struct TodayHealth {
  var steps: Double = 0
  var distanceMi: Double = 0
  var exerciseMinutes: Double = 0
  var workouts: Int = 0
}

final class HealthReader {
  static let shared = HealthReader()
  let store = HKHealthStore()

  private var readTypes: Set<HKObjectType> {
    var types = Set<HKObjectType>()
    if let t = HKObjectType.quantityType(forIdentifier: .stepCount) { types.insert(t) }
    if let t = HKObjectType.quantityType(forIdentifier: .distanceWalkingRunning) { types.insert(t) }
    if let t = HKObjectType.quantityType(forIdentifier: .appleExerciseTime) { types.insert(t) }
    types.insert(HKObjectType.workoutType())
    return types
  }

  func requestAccess() async {
    guard HKHealthStore.isHealthDataAvailable() else { return }
    try? await store.requestAuthorization(toShare: [], read: readTypes)
  }

  func today() async -> TodayHealth {
    var health = TodayHealth()
    health.steps = await sum(.stepCount, unit: .count())
    health.distanceMi = await sum(.distanceWalkingRunning, unit: .mile())
    health.exerciseMinutes = await sum(.appleExerciseTime, unit: .minute())
    health.workouts = await workoutCount()
    return health
  }

  private func startOfToday() -> Date {
    Calendar.current.startOfDay(for: Date())
  }

  private func sum(_ id: HKQuantityTypeIdentifier, unit: HKUnit) async -> Double {
    guard let type = HKQuantityType.quantityType(forIdentifier: id) else { return 0 }
    let predicate = HKQuery.predicateForSamples(withStart: startOfToday(), end: Date(), options: .strictStartDate)
    return await withCheckedContinuation { (cont: CheckedContinuation<Double, Never>) in
      let query = HKStatisticsQuery(quantityType: type, quantitySamplePredicate: predicate, options: .cumulativeSum) { _, result, _ in
        cont.resume(returning: result?.sumQuantity()?.doubleValue(for: unit) ?? 0)
      }
      store.execute(query)
    }
  }

  private func workoutCount() async -> Int {
    let predicate = HKQuery.predicateForSamples(withStart: startOfToday(), end: Date(), options: .strictStartDate)
    return await withCheckedContinuation { (cont: CheckedContinuation<Int, Never>) in
      let query = HKSampleQuery(sampleType: HKObjectType.workoutType(), predicate: predicate, limit: HKObjectQueryNoLimit, sortDescriptors: nil) { _, samples, _ in
        cont.resume(returning: samples?.count ?? 0)
      }
      store.execute(query)
    }
  }
}
