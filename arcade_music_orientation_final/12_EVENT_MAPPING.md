# Mapping gameplay → musique

## Breaker
Inputs :
- remainingBricks
- ballSpeed
- combo
- powerUps
- lives

Mappings :
- ballSpeed → rhythmic density
- combo → momentum
- remainingBricks faible → tension
- dernière brique → résolution quantifiée

## Cave Runner
Inputs :
- playerSpeed
- tunnelWidth
- obstacleDensity
- nearMissRate
- distance

Mappings :
- speed → subdivision
- tunnelWidth → tension/space
- obstacleDensity → complexity
- nearMissRate → danger
- distance → narrativeArc

## Fish
Inputs :
- fishPresent
- lineTension
- fishStrength
- catchProgress
- environmentCalm

Mappings :
- idle → calm
- bite → tension accent
- lineTension → danger
- fishStrength → intensity
- catchProgress → triumph

## Golf
Inputs :
- shotPower
- ballVelocity
- distanceToHole
- strokeCount
- ballInDangerZone

Mappings :
- tir → ponctuation
- ball moving → espace
- distanceToHole → anticipation
- hole → résolution
- holeInOne → événement majeur

## Runner
Inputs :
- speed
- distance
- obstacleRate
- streak
- nearMissRate

Mappings :
- speed → rhythmic density
- distance → narrativeArc
- streak → momentum
- nearMissRate → danger

## Shooter
Inputs :
- enemyCount
- bulletDensity
- playerHealth
- killRate
- combo
- bossHealth
- powerLevel

Mappings :
- enemyCount → intensity
- bulletDensity → danger
- killRate → momentum
- combo → brightness
- bossHealth → tension + macro section
- powerLevel → orchestration

## Simon
Inputs :
- sequenceLength
- computerTurn
- playerTurn
- success
- failure

Mappings :
- présentation → accompagnement presque coupé
- playerTurn → pad très discret
- réussite → résolution
- erreur → tension courte

## Snake
Inputs :
- snakeLength
- foodStreak
- movementSpeed
- boardOccupancy

Mappings :
- length → complexity
- speed → rhythmic density
- foodStreak → momentum
- occupancy → tension

## Survival
Inputs :
- wave
- waveProgress
- enemyCount
- enemyDensity
- closestEnemyDistance
- playerHealth
- nearMissRate
- timeSinceLastHit
- scoreMultiplier

Mappings :
- wave → narrativeArc
- enemyDensity → intensity
- closestEnemyDistance → danger
- playerHealth faible → tension
- nearMissRate → rhythmic tension
- timeSinceLastHit → momentum
- waveProgress → section

## Rhythm
La musique ne reçoit pas simplement un état.

Le moteur émet `MusicalEvent[]`, puis `ChartGenerator` choisit les événements jouables selon la difficulté.
